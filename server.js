import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './db.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware for auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Forbidden' });
    req.user = user;
    next();
  });
};

// POST /register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existing = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(400).json({ message: 'Username already taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(401).json({ message: 'Invalid credentials' });

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /dashboard
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const transactions = await db.query('SELECT type, amount, commission FROM transactions');
    const debts = await db.query('SELECT type, amount FROM debts WHERE status = "unpaid"');
    const settings = await db.query('SELECT opening_balance FROM settings WHERE id = 1');

    const cashRows = await db.query('SELECT * FROM cash_balance WHERE id = 1');
    const cash = cashRows[0] || {};
    const RATE = 90000;

    // Calculate actual balance from cash liquidity
    const balance = 
      (Number(cash.system_usd || 0) + Number(cash.system_lbp || 0) / RATE) +
      (Number(cash.mobile_usd || 0) + Number(cash.mobile_lbp || 0) / RATE) +
      (Number(cash.physical_usd || 0) + Number(cash.physical_lbp || 0) / RATE);

    let totalCommissions = 0;
    transactions.forEach(t => {
      totalCommissions += Number(t.commission);
    });

    let owedToMe = 0;
    let iOwe = 0;
    debts.forEach(d => {
      if (d.type === 'owed_to_me') owedToMe += Number(d.amount);
      else iOwe += Number(d.amount);
    });

    const clientSummaries = await db.query(`
      SELECT c.id, c.name, 
        SUM(CASE WHEN d.type = 'owed_to_me' AND d.status = 'unpaid' THEN d.amount ELSE 0 END) as owed_to_me,
        SUM(CASE WHEN d.type = 'i_owe' AND d.status = 'unpaid' THEN d.amount ELSE 0 END) as i_owe
      FROM clients c
      LEFT JOIN debts d ON c.id = d.client_id
      GROUP BY c.id, c.name
      HAVING owed_to_me > 0 OR i_owe > 0
      LIMIT 5
    `);

    res.json({
      balance,
      totalCommissions,
      owedToMe,
      iOwe,
      clientSummaries
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT t.*, c.name as client_name 
      FROM transactions t 
      LEFT JOIN clients c ON t.client_id = c.id 
      ORDER BY t.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /transactions
app.post('/api/transactions', authenticateToken, async (req, res) => {
  const { type, amount, commission, client_id } = req.body;
  if (!type || !amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount or type' });
  }
  try {
    await db.query(
      'INSERT INTO transactions (type, amount, commission, client_id) VALUES (?, ?, ?, ?)',
      [type, amount, commission || 0, client_id || null]
    );
    res.status(201).json({ message: 'Transaction recorded' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/transactions/:id
app.put('/api/transactions/:id', authenticateToken, async (req, res) => {
  const { type, amount, commission, client_id } = req.body;
  try {
    await db.query(
      'UPDATE transactions SET type = ?, amount = ?, commission = ?, client_id = ? WHERE id = ?',
      [type, amount, commission, client_id || null, req.params.id]
    );
    res.json({ message: 'Transaction updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /clients
app.get('/api/clients', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM clients ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /clients
app.post('/api/clients', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  try {
    await db.query('INSERT INTO clients (name, phone) VALUES (?, ?)', [name, phone]);
    res.status(201).json({ message: 'Client added' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/clients/:id
app.put('/api/clients/:id', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  try {
    await db.query('UPDATE clients SET name = ?, phone = ? WHERE id = ?', [name, phone, req.params.id]);
    res.json({ message: 'Client updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/clients/:id
app.delete('/api/clients/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /debts
app.get('/api/debts', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT d.*, c.name as client_name 
      FROM debts d 
      JOIN clients c ON d.client_id = c.id 
      ORDER BY d.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /debts
app.post('/api/debts', authenticateToken, async (req, res) => {
  const { client_id, amount, type } = req.body;
  if (!client_id || !amount || amount <= 0 || !type) {
    return res.status(400).json({ message: 'Invalid debt data' });
  }
  try {
    await db.query(
      'INSERT INTO debts (client_id, amount, type, status) VALUES (?, ?, ?, "unpaid")',
      [client_id, amount, type]
    );
    res.status(201).json({ message: 'Debt recorded' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/debts/:id
app.put('/api/debts/:id', authenticateToken, async (req, res) => {
  const { client_id, amount, type, status } = req.body;
  try {
    await db.query(
      'UPDATE debts SET client_id = ?, amount = ?, type = ?, status = ? WHERE id = ?',
      [client_id, amount, type, status, req.params.id]
    );
    res.json({ message: 'Debt updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/debts/:id
app.delete('/api/debts/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM debts WHERE id = ?', [req.params.id]);
    res.json({ message: 'Debt deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /debts/:id/pay
app.put('/api/debts/:id/pay', authenticateToken, async (req, res) => {
  try {
    await db.query('UPDATE debts SET status = "paid" WHERE id = ?', [req.params.id]);
    res.json({ message: 'Debt marked as paid' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/clients/ledger/:name
app.get('/api/clients/ledger/:name', authenticateToken, async (req, res) => {
  try {
    const clients = await db.query('SELECT * FROM clients WHERE name = ?', [req.params.name]);
    if (clients.length === 0) return res.status(404).json({ message: 'Client not found' });

    const client = clients[0];
    const transactions = await db.query('SELECT * FROM transactions WHERE client_id = ? ORDER BY created_at DESC', [client.id]);
    const debts = await db.query('SELECT * FROM debts WHERE client_id = ? ORDER BY created_at DESC', [client.id]);

    res.json({ client, transactions, debts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/cash-balance
app.get('/api/cash-balance', authenticateToken, async (req, res) => {
  try {
    const cash = await db.query('SELECT * FROM cash_balance WHERE id = 1');
    res.json(cash[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/cash-balance
app.post('/api/cash-balance', authenticateToken, async (req, res) => {
  const { system_usd, system_lbp, mobile_usd, mobile_lbp, physical_usd, physical_lbp } = req.body;
  try {
    await db.query(
      `UPDATE cash_balance SET 
        system_usd = ?, system_lbp = ?, 
        mobile_usd = ?, mobile_lbp = ?, 
        physical_usd = ?, physical_lbp = ? 
      WHERE id = 1`,
      [system_usd, system_lbp, mobile_usd, mobile_lbp, physical_usd, physical_lbp]
    );
    res.json({ message: 'Cash balance updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/settings/balance
app.post('/api/settings/balance', authenticateToken, async (req, res) => {
  const { amount } = req.body;
  try {
    await db.query('UPDATE settings SET opening_balance = ? WHERE id = 1', [amount]);
    res.json({ message: 'Opening balance updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
