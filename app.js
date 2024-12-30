/**************************************************************
 * app.js
 * A Node.js + Express server using Sequelize to connect
 * to a Supabase Postgres DB (with SSL).
 * The primary key is a UUID, and we store a "frontend_id"
 * in the format "TW-XXXXXX".
 **************************************************************/
require('dotenv').config(); // Loads .env variables

const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

const app = express();
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
      // For self-signed or no local CA, set to false:
      rejectUnauthorized: false
    }
  }
});

// 3) Define the User model
//    `id`: a real UUID primary key
//    `frontend_id`: your custom "TW-XXXXXX" field
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4, // auto-generate UUID
    primaryKey: true,
  },
  wallet_address: {
    type: DataTypes.STRING,
    allowNull: false,
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
    allowNull: true,        // you can make it NOT NULL if you prefer
  },
}, {
  tableName: 'users',  // match your actual DB table
  timestamps: false,
});

// 4) Generate a short referral code & frontend_id
function generateReferralCode() {
  return uuidv4().slice(0, 8); // e.g. "abcd1234"
}

function generateFrontendId() {
  // Generate a 6-digit random number between 100000 and 999999
  const random6 = Math.floor(Math.random() * 900000) + 100000;
  return `TW-${random6}`;
}

/***************************************
 * 5) Express Routes
 ***************************************/

// Health check
app.get('/', (req, res) => {
  res.send("Welcome to the Express Referral System!");
});

/**
 * POST /register
 * Body: { "wallet_address": "0x123..." }
 * Creates a new user with a unique UUID, a "TW-xxxxxx" frontend_id,
 * and a referral code. No referrer in this route.
 */
app.post('/register', async (req, res) => {
  try {
    const { wallet_address } = req.body;
    if (!wallet_address) {
      return res.status(400).json({ error: "Missing wallet_address" });
    }

    const referral_code = generateReferralCode();
    const frontend_id = generateFrontendId();

    // Create the user in DB
    const newUser = await User.create({
      wallet_address,
      referral_code,
      frontend_id
    });

    // Example referral link (use your domain in production)
    const referralLink = `http://localhost:3000/referral/${newUser.referral_code}`;

    res.status(201).json({
      message: "User registered successfully",
      user_uuid: newUser.id,          // internal UUID
      frontend_id: newUser.frontend_id, // "TW-XXXXXX"
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
 * Retrieves the user who owns this referral code
 */
app.get('/referral/:referral_code', async (req, res) => {
  try {
    const { referral_code } = req.params;

    const user = await User.findOne({ where: { referral_code } });
    if (!user) {
      return res.status(404).json({ error: "Invalid referral code" });
    }

    // Return both the internal UUID and the frontend ID
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
 * Creates a new user with a "TW-xxxxxx" frontend_id, 
 * increments the referrer's total_referrals by 1.
 */
app.post('/register-referred', async (req, res) => {
  try {
    const { wallet_address, referred_by } = req.body;
    if (!wallet_address || !referred_by) {
      return res
        .status(400)
        .json({ error: "Missing wallet_address or referred_by" });
    }

    // Check if the referrer exists
    const referrer = await User.findOne({ where: { wallet_address: referred_by } });
    if (!referrer) {
      return res.status(404).json({ error: "Referrer not found" });
    }

    const referral_code = generateReferralCode();
    const frontend_id = generateFrontendId();

    // Create the new user
    const newUser = await User.create({
      wallet_address,
      referral_code,
      frontend_id,
      referred_by
    });

    // Increment the referrer's total_referrals
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
 * 6) Sync DB and Start Server
 ***************************************/
(async () => {
  try {
    // Sync models with DB (creates table/columns if not exist)
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
