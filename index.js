const express = require("express");
const cors = require("cors");
require("dotenv").config();

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🧠 FIREBASE ADMIN
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("University Universal Payment Server Running");
});


// 🧱 STEP 19A.4 — PAYMENT INTENT
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        error: "Amount is required",
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "kes",
      payment_method_types: ["card"],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });

  } catch (error) {
    console.log("Stripe error:", error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});


// 🧱 STEP 19A.5 — CHECKOUT SESSION (KES + USD SUPPORT)
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { userId, plan, currency } = req.body;

    let price = 0;

    // 🇰🇪 Kenya pricing
    if (currency === "kes") {
      if (plan === "daily") price = 50;      
      if (plan === "weekly") price = 200;    
      if (plan === "monthly") price = 800;   
    }

    // 🇺🇸 USD pricing
    if (currency === "usd") {
      if (plan === "daily") price = 50;      // $0.50
      if (plan === "weekly") price = 200;    // $2.00
      if (plan === "monthly") price = 650;   // $6.50
    }

    if (!price) {
      return res.status(400).json({
        error: "Invalid plan or currency",
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: currency,   // kes or usd
            product_data: {
              name: `University Universal ${plan} subscription`,
            },

            // Stripe smallest unit
            unit_amount: price,
          },

          quantity: 1,
        },
      ],

      success_url: `${process.env.BASE_URL}/success?userId=${userId}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    res.json({
      url: session.url,
    });

  } catch (error) {
    console.log("Checkout error:", error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});


// 🧱 STEP 19A.7 — SUCCESS ENDPOINT
app.get("/success", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send("Missing userId");
    }

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send("User not found");
    }

    await userRef.update({
      isPremium: true,
    });

    res.send("Payment successful. You are now Premium.");

  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong");
  }
});


// 🧱 CANCEL ROUTE
app.get("/cancel", (req, res) => {
  res.send("Payment cancelled. You were not charged.");
});


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});