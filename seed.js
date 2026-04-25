import { createConnection } from 'mariadb';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

async function seed() {
  let conn;
  try {
    // Connect without database to create it
    conn = await createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });

    console.log('Connected to MariaDB...');

    await conn.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    await conn.query(`USE ${process.env.DB_NAME}`);

    console.log(`Using database ${process.env.DB_NAME}...`);

    // Create users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      )
    `);

    // Create clients table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20)
      )
    `);

    // Create transactions table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('deposit', 'withdrawal') NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        commission DECIMAL(15, 2) DEFAULT 0,
        client_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
      )
    `);

    // Create debts table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS debts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        type ENUM('owed_to_me', 'i_owe') NOT NULL,
        status ENUM('unpaid', 'paid') DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);

    // Create settings table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT PRIMARY KEY DEFAULT 1,
        opening_balance DECIMAL(15, 2) DEFAULT 0,
        CHECK (id = 1)
      )
    `);

    // Initialize settings
    const settingsRows = await conn.query('SELECT * FROM settings WHERE id = 1');
    if (settingsRows.length === 0) {
      await conn.query('INSERT INTO settings (id, opening_balance) VALUES (1, 0)');
    }

    // Create cash_balance table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS cash_balance (
        id INT PRIMARY KEY DEFAULT 1,
        system_usd DECIMAL(15,2) DEFAULT 0,
        system_lbp DECIMAL(15,2) DEFAULT 0,
        mobile_usd DECIMAL(15,2) DEFAULT 0,
        mobile_lbp DECIMAL(15,2) DEFAULT 0,
        physical_usd DECIMAL(15,2) DEFAULT 0,
        physical_lbp DECIMAL(15,2) DEFAULT 0,
        CHECK (id = 1)
      )
    `);

    const cashRows = await conn.query('SELECT * FROM cash_balance WHERE id = 1');
    if (cashRows.length === 0) {
      await conn.query('INSERT INTO cash_balance (id) VALUES (1)');
    }

    console.log('Tables created successfully.');

    // Create admin user if not exists
    const users = await conn.query('SELECT * FROM users WHERE username = ?', ['admin']);
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await conn.query('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hashedPassword]);
      console.log('Admin user created (admin / admin123)');
    } else {
      console.log('Admin user already exists.');
    }

  } catch (err) {
    console.error('Error seeding database:', err);
  } finally {
    if (conn) conn.end();
  }
}

seed();
