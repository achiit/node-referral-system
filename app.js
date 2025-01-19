require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
app.use(cors());
app.use(express.json());

// Add this before your routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error("Missing DB_URL environment variable. Check your .env file!");
  process.exit(1);
}

const sequelize = new Sequelize(DB_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Updated User model
const User = sequelize.define('User', {
  userid: {
    type: DataTypes.STRING(9),  // Exactly 9 characters
    primaryKey: true,
  },
  wallet_address: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  referred_by: {
    type: DataTypes.STRING(9),
    allowNull: true,
  },
  referred_users: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: [],
  },
  total_referrals: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  }
}, {
  tableName: 'users',
  timestamps: false,
});

// Generate 9-character alphanumeric ID
function generateUserId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 9; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Routes
app.get('/', (req, res) => {
  res.send("Welcome to the Express Referral System!");
});

app.get('/user/:wallet_address', async (req, res) => {
  try {
    const { wallet_address } = req.params;
    const user = await User.findOne({ where: { wallet_address } });
    
    if (!user) {
      return res.status(404).json({ error: "User not found for that wallet address." });
    }

    res.json({
      userid: user.userid,
      wallet_address: user.wallet_address,
      referred_by: user.referred_by,
      referred_users: user.referred_users,
      total_referrals: user.total_referrals,
      created_at: user.created_at
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { wallet_address } = req.body;
    if (!wallet_address) {
      return res.status(400).json({ error: "Missing wallet_address" });
    }

    const existingUser = await User.findOne({ where: { wallet_address } });
    if (existingUser) {
      return res.status(400).json({ error: "This wallet address is already registered." });
    }

    const userid = generateUserId();
    const newUser = await User.create({
      userid,
      wallet_address,
    });

    const referralLink = `http://localhost:3000/referral/${userid}`;

    res.status(201).json({
      message: "User registered successfully",
      userid: newUser.userid,
      wallet_address: newUser.wallet_address,
      referral_link: referralLink
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/referral/:userid', async (req, res) => {
  try {
    const { userid } = req.params;
    const user = await User.findOne({ where: { userid } });
    
    if (!user) {
      return res.status(404).json({ error: "Invalid user ID" });
    }

    res.json({
      userid: user.userid,
      referring_wallet: user.wallet_address
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/register-referred', async (req, res) => {
  try {
    const { wallet_address, referred_by } = req.body;
    if (!wallet_address || !referred_by) {
      return res.status(400).json({ error: "Missing wallet_address or referred_by" });
    }

    const existingUser = await User.findOne({ where: { wallet_address } });
    if (existingUser) {
      return res.status(400).json({ error: "This wallet address is already registered." });
    }

    const referrer = await User.findOne({ where: { userid: referred_by } });
    if (!referrer) {
      return res.status(404).json({ error: "Referrer not found" });
    }

    const userid = generateUserId();
    const newUser = await User.create({
      userid,
      wallet_address,
      referred_by
    });

    // Update referrer's referred_users list and total_referrals
    referrer.referred_users = [...referrer.referred_users, userid];
    referrer.total_referrals += 1;
    await referrer.save();

    res.status(201).json({
      message: "User registered with referral successfully",
      userid: newUser.userid,
      wallet_address: newUser.wallet_address,
      referrer_new_total: referrer.total_referrals
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/bulk-lookup', async (req, res) => {
  try {
    const { wallet_addresses } = req.body;
    
    if (!Array.isArray(wallet_addresses)) {
      return res.status(400).json({ error: "wallet_addresses must be an array" });
    }

    const users = await User.findAll({
      where: {
        wallet_address: wallet_addresses
      },
      attributes: ['wallet_address', 'userid']
    });

    // Create a mapping of wallet_address to userid
    const mapping = {};
    users.forEach(user => {
      mapping[user.wallet_address] = user.userid;
    });

    res.json({ mapping });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
(async () => {
  try {
    await sequelize.sync({ force: false });
    console.log("Database synced successfully!");

    const PORT = process.env.PORT || 3003;
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to sync DB: ", err);
    process.exit(1);
  }
})();