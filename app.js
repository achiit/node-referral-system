/**************************************************************
 * app.js
 * A Node.js + Express server using Sequelize to connect
 * to a Supabase Postgres DB (with SSL).
 * - id: a true UUID primary key
 * - wallet_address: unique, so same address can't register twice
 * - frontend_id: a "TW-XXXXXX" ID for display
 **************************************************************/
require('dotenv').config(); // Loads .env variables

const express = require('express');
const cors = require('cors');         // <-- Import cors
const { Sequelize, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

const app = express();

// 1) Allow CORS for all origins
app.use(cors());               // <-- This allows requests from any origin
app.use(express.json());

// 1) Read the single DB_URL from environment
const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error("Missing DB_URL environment variable. Check your .env file!");
  process.exit(1);
}

// 2) Initialize Sequelize with SSL required for Supabase
const sequelize = new Sequelize(DB_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      // For self-signed or no local CA, you can set to false:
      rejectUnauthorized: false
    }
  }
});

// 3) Define the User model
//    `wallet_address` is unique, so no duplicates allowed.
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4, // auto-generate UUID
    primaryKey: true,
  },
  wallet_address: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // important: ensures one wallet per user
  },
  referral_code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  referred_by: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  total_referrals: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  frontend_id: {
    type: DataTypes.STRING, // e.g., "TW-123456"
    allowNull: true,
  },
}, {
  tableName: 'users',
  timestamps: false,
});

// Generate a short referral code
function generateReferralCode() {
  return uuidv4().slice(0, 8); // e.g. "abcd1234"
}

// Generate the "TW-XXXXXX" ID
function generateFrontendId() {
  // Generate 6-digit random number between 100000 and 999999
  const random6 = Math.floor(Math.random() * 900000) + 100000;
  return `TW-${random6}`;
}

/***************************************
 * Express Routes
 ***************************************/

// Simple welcome route
app.get('/', (req, res) => {
  res.send("Welcome to the Express Referral System!");
});

/**
 * POST /register
 * Body: { "wallet_address": "0xABC123" }
 * Creates a new user if wallet_address not used before.
 */
app.post('/register', async (req, res) => {
  try {
    const { wallet_address } = req.body;
    if (!wallet_address) {
      return res.status(400).json({ error: "Missing wallet_address" });
    }

    // Check if this wallet is already registered
    const existingUser = await User.findOne({ where: { wallet_address } });
    if (existingUser) {
      return res.status(400).json({ error: "This wallet address is already registered." });
    }

    const referral_code = generateReferralCode();
    const frontend_id = generateFrontendId();

    // Create the user
    const newUser = await User.create({
      wallet_address,
      referral_code,
      frontend_id
    });

    const referralLink = `http://localhost:3000/referral/${newUser.referral_code}`;

    res.status(201).json({
      message: "User registered successfully",
      user_uuid: newUser.id,
      frontend_id: newUser.frontend_id,
      wallet_address: newUser.wallet_address,
      referral_link: referralLink
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /referral/:referral_code
 * Fetches the user for the given referral_code.
 */
app.get('/referral/:referral_code', async (req, res) => {
  try {
    const { referral_code } = req.params;

    const user = await User.findOne({ where: { referral_code } });
    if (!user) {
      return res.status(404).json({ error: "Invalid referral code" });
    }

    res.json({
      user_uuid: user.id,
      frontend_id: user.frontend_id,
      referring_wallet: user.wallet_address
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /register-referred
 * Body: { "wallet_address": "0xNewUser", "referred_by": "0xReferrer" }
 * Creates a user if wallet_address not used before, then increments the referrer's total_referrals by 1.
 */
app.post('/register-referred', async (req, res) => {
  try {
    const { wallet_address, referred_by } = req.body;
    if (!wallet_address || !referred_by) {
      return res
        .status(400)
        .json({ error: "Missing wallet_address or referred_by" });
    }

    // Check if this wallet is already registered
    const existingUser = await User.findOne({ where: { wallet_address } });
    if (existingUser) {
      return res.status(400).json({ error: "This wallet address is already registered." });
    }

    // Check if the referrer exists
    const referrer = await User.findOne({ where: { wallet_address: referred_by } });
    if (!referrer) {
      return res.status(404).json({ error: "Referrer not found" });
    }

    const referral_code = generateReferralCode();
    const frontend_id = generateFrontendId();

    // Create new user
    const newUser = await User.create({
      wallet_address,
      referral_code,
      frontend_id,
      referred_by
    });

    // Increment referrer's total_referrals
    referrer.total_referrals += 1;
    await referrer.save();

    res.status(201).json({
      message: "User registered with referral successfully",
      new_user_uuid: newUser.id,
      new_user_frontend_id: newUser.frontend_id,
      new_user_wallet: newUser.wallet_address,
      referral_code: newUser.referral_code,
      referrer_new_total: referrer.total_referrals
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/***************************************
 * Sync DB and Start Server
 ***************************************/
(async () => {
  try {
    // Sync models with DB
    await sequelize.sync({ force: false });
    console.log("Database synced successfully!");

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to sync DB: ", err);
    process.exit(1);
  }
})();
