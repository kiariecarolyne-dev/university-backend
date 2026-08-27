const express = require("express");
const cors = require("cors");
require("dotenv").config();

const crypto = require("crypto");

const axios = require("axios");
const moment = require("moment");
const cron = require("node-cron");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const { v4: uuidv4 } = require("uuid");

const multer = require("multer");

const { createClient } = require("@supabase/supabase-js");


// ====================================
// MULTER CONFIG
// ====================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});


// ====================================
// FIREBASE INIT
// ====================================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: "university-universal-e6787.firebasestorage.app",
});

const db = getFirestore();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl === "/lemon-webhook") {
        req.rawBody = buf;
      }
    },
  })
);





// ====================================
// ACTIVATE PREMIUM
// ====================================

const activatePremium = async (userId, plan) => {
  try {
    console.log("====================================");
    console.log("ACTIVATING PREMIUM");
    console.log("USER ID:", userId);
    console.log("PLAN:", plan);

    if (!userId) {
      throw new Error("Missing userId");
    }

    if (!["weekly", "monthly"].includes(plan)) {
      throw new Error("Invalid Premium plan");
    }

    const premiumUntil = new Date();

    if (plan === "weekly") {
      premiumUntil.setDate(premiumUntil.getDate() + 7);
    }

    if (plan === "monthly") {
      premiumUntil.setMonth(premiumUntil.getMonth() + 1);
    }

    console.log("PREMIUM UNTIL:", premiumUntil.toISOString());

    await db.collection("users").doc(userId).set(
      {
        isPremium: true,
        premiumPlan: plan,
        premiumUntil: premiumUntil.toISOString(),
      },
      { merge: true }
    );

    console.log("FIRESTORE UPDATED SUCCESSFULLY");
    console.log("PREMIUM ACTIVATED SUCCESSFULLY");
    console.log("====================================");

  } catch (error) {
    console.log("ACTIVATE PREMIUM ERROR:", error.message);
    throw error;
  }
};


// ====================================
// HOME
// ====================================
app.get("/", (req, res) => {
  res.send("University Universal Payment Server Running");
});


// ====================================
// MANUAL CONFIRM PAYMENT
// ====================================
app.post("/confirm-payment", async (req, res) => {
  try {
    const { userId, plan } = req.body;

    console.log("CONFIRM PAYMENT HIT");
    console.log("USER:", userId);
    console.log("PLAN:", plan);

    if (!userId || !plan) {
      return res.status(400).json({
        error: "Missing userId or plan",
      });
    }

    await activatePremium(userId, plan);

    res.json({ success: true });

  } catch (error) {
    console.log("CONFIRM PAYMENT ERROR:", error.message);

    res.status(500).json({
      error: "Payment confirmation failed",
    });
  }
});




// ====================================
// MPESA ACCESS TOKEN
// LIVE
// ====================================

const getMpesaAccessToken = async () => {
  try {
    console.log("====================================");
    console.log("GETTING LIVE MPESA ACCESS TOKEN");

    if (!process.env.MPESA_CONSUMER_KEY) {
      throw new Error("MPESA_CONSUMER_KEY is missing");
    }

    if (!process.env.MPESA_CONSUMER_SECRET) {
      throw new Error("MPESA_CONSUMER_SECRET is missing");
    }

    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");

    console.log("MPESA CREDENTIALS FOUND");
    console.log("CONTACTING SAFARICOM OAUTH...");

    const response = await axios.get(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        timeout: 15000,
      }
    );

    console.log("MPESA ACCESS TOKEN RECEIVED");
    console.log(
      "TOKEN RESPONSE CODE:",
      response.status
    );

    if (!response.data?.access_token) {
      throw new Error(
        "Safaricom did not return an access token"
      );
    }

    return response.data.access_token;

  } catch (error) {
    console.log("====================================");
    console.log("MPESA TOKEN ERROR");

    if (error.code === "ECONNABORTED") {
      console.log(
        "ERROR: Safaricom OAuth request timed out"
      );
    }

    if (error.response) {
      console.log(
        "STATUS:",
        error.response.status
      );

      console.log(
        "DATA:",
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      );
    } else {
      console.log(
        "MESSAGE:",
        error.message
      );
    }

    throw error;
  }
};


// ====================================
// MPESA PASSWORD
// ====================================

const generateMpesaPassword = () => {
  const timestamp = moment().format("YYYYMMDDHHmmss");

  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  return {
    password,
    timestamp,
  };
};


// ====================================
// MPESA PAYMENT
// LIVE
// ====================================

app.post("/mpesa-payment", async (req, res) => {
  console.log("====================================");
  console.log("MPESA PAYMENT ROUTE HIT");

  try {
    const { phone, userId, plan } = req.body;

    console.log("USER ID:", userId);
    console.log("PLAN:", plan);
    console.log("PHONE:", phone);

    // ====================================
    // VALIDATE PLAN
    // ====================================

    let amount;

    if (plan === "weekly") {
      amount = 50;
    } else if (plan === "monthly") {
      amount = 150;
    } else {
      return res.status(400).json({
        error: "Invalid Premium plan",
      });
    }

    // ====================================
    // VALIDATE REQUEST
    // ====================================

    if (!phone || !userId || !plan) {
      return res.status(400).json({
        error: "Missing phone, userId or plan",
      });
    }

    console.log("SECURE AMOUNT:", amount);

    // ====================================
    // GET MPESA TOKEN
    // ====================================

    console.log("GETTING MPESA ACCESS TOKEN...");

    const accessToken = await getMpesaAccessToken();

    console.log("MPESA TOKEN RECEIVED");

    // ====================================
    // GENERATE PASSWORD
    // ====================================

    const { password, timestamp } =
      generateMpesaPassword();

    console.log("TIMESTAMP:", timestamp);

    // ====================================
    // SEND STK PUSH
    // ====================================

    console.log("SENDING LIVE MPESA STK PUSH");

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode:
          process.env.MPESA_SHORTCODE,

        Password: password,

        Timestamp: timestamp,

        TransactionType:
          "CustomerBuyGoodsOnline",

        Amount: amount,

        PartyA: phone,

        PartyB:
  process.env.MPESA_TILL_NUMBER,

        PhoneNumber: phone,

        CallBackURL:
          process.env.MPESA_CALLBACK_URL,

        AccountReference:
          "UniversityUniversal",

        TransactionDesc:
          `Premium ${plan}`,
      },
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",
        },
      }
    );

    console.log("====================================");
    console.log("MPESA STK RESPONSE");
    console.log(response.data);
    console.log("====================================");

    // ====================================
    // CHECK SAFARICOM RESPONSE
    // ====================================

    if (!response.data?.CheckoutRequestID) {
      return res.status(500).json({
        error:
          "M-Pesa did not return a CheckoutRequestID",
        details: response.data,
      });
    }

    // ====================================
    // SAVE PENDING PAYMENT
    // ====================================

    await db
      .collection("mpesa_pending")
      .doc(response.data.CheckoutRequestID)
      .set({
        userId,
        plan,
        phone,
        amount,
        checkoutRequestId:
          response.data.CheckoutRequestID,
        merchantRequestId:
          response.data.MerchantRequestID || null,
        createdAt:
          new Date().toISOString(),
        status: "pending",
      });

    console.log(
      "PENDING MPESA PAYMENT SAVED"
    );

    return res.json({
      success: true,
      message:
        "M-Pesa payment request sent",
      data: response.data,
    });

  } catch (error) {
    console.log("====================================");
    console.log("MPESA PAYMENT ERROR");

    if (error.response) {
      console.log(
        "STATUS:",
        error.response.status
      );

      console.log(
        "DATA:",
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      );
    } else {
      console.log(
        "MESSAGE:",
        error.message
      );
    }

    return res.status(500).json({
      error:
        "M-Pesa payment failed",
      details:
        error.response?.data ||
        error.message,
    });
  }
});

// ====================================
// MPESA CALLBACK
// ====================================

app.post("/mpesa-callback", async (req, res) => {
  console.log("====================================");
  console.log("MPESA CALLBACK RECEIVED");

  try {
    const callback =
      req.body?.Body?.stkCallback;

      console.log(
  "FULL STK CALLBACK:",
  JSON.stringify(callback, null, 2)
);

    if (!callback) {
      console.log("INVALID CALLBACK BODY");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const checkoutId =
      callback.CheckoutRequestID;

    const resultCode =
      callback.ResultCode;

    console.log(
      "CHECKOUT REQUEST ID:",
      checkoutId
    );

    console.log(
      "RESULT CODE:",
      resultCode
    );

    console.log(
  "RESULT DESCRIPTION:",
  callback.ResultDesc
);

    // ====================================
    // PAYMENT FAILED / CANCELLED
    // ====================================

    if (resultCode !== 0) {
      console.log(
        "MPESA PAYMENT NOT SUCCESSFUL"
      );

      const pendingRef =
        db.collection("mpesa_pending")
          .doc(checkoutId);

      await pendingRef.set(
        {
          status: "failed",
          resultCode,
          resultDescription:
            callback.ResultDesc ||
            "Payment failed",
          updatedAt:
            new Date().toISOString(),
        },
        { merge: true }
      );

      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    // ====================================
    // FIND PENDING PAYMENT
    // ====================================

    const pendingRef =
      db.collection("mpesa_pending")
        .doc(checkoutId);

    const pendingDoc =
      await pendingRef.get();

    if (!pendingDoc.exists) {
      console.log(
        "PENDING PAYMENT NOT FOUND"
      );

      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const {
      userId,
      plan,
    } = pendingDoc.data();

    console.log(
      "ACTIVATING PREMIUM:",
      userId,
      plan
    );

    // ====================================
    // ACTIVATE PREMIUM
    // ====================================

    await activatePremium(
      userId,
      plan
    );

    // ====================================
    // DELETE PENDING PAYMENT
    // ====================================

    await pendingRef.delete();

    console.log(
      "MPESA PAYMENT COMPLETED"
    );

    console.log(
      "PREMIUM ACTIVATED"
    );

    return res.json({
      ResultCode: 0,
      ResultDesc: "Success",
    });

  } catch (error) {
    console.log(
      "MPESA CALLBACK ERROR:",
      error.message
    );

    // Always acknowledge callback
    return res.json({
      ResultCode: 0,
      ResultDesc: "Received",
    });
  }
});

// ====================================
// EXPIRE PREMIUM DAILY
// ====================================

cron.schedule("0 0 * * *", async () => {
  try {
    console.log(
      "CHECKING EXPIRED PREMIUM ACCOUNTS"
    );

    const users =
      await db.collection("users").get();

    const now = new Date();

    for (const doc of users.docs) {
      const user = doc.data();

      if (
        user.isPremium &&
        user.premiumUntil
      ) {
        const expiry =
          new Date(user.premiumUntil);

        if (now >= expiry) {
          console.log(
            "EXPIRING PREMIUM:",
            doc.id
          );

          await db
            .collection("users")
            .doc(doc.id)
            .set(
              {
                isPremium: false,
                premiumUntil: null,
                premiumPlan: null,
              },
              { merge: true }
            );
        }
      }
    }

    console.log(
      "PREMIUM CLEANUP DONE"
    );

  } catch (error) {
    console.log(
      "CRON ERROR:",
      error.message
    );
  }
});


// ====================================
// UPLOAD MULTIPLE PAST PAPERS
// ====================================
app.post(
  "/upload-pastpapers",
  upload.array("files", 100),
  async (req, res) => {
    try {
      console.log("UPLOAD MULTIPLE PAST PAPERS");

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: "No PDF files uploaded",
        });
      }

      const uploaded = [];
      const failed = [];

      for (const file of req.files) {
        try {
          // Remove .pdf from filename to create paper name
          const cleanOriginalName =
            decodeURIComponent(file.originalname);

          const paperName = cleanOriginalName.replace(
            /\.pdf$/i,
            ""
          );

          const fileName =
            `${uuidv4()}-${cleanOriginalName}`;

          // Upload PDF to Supabase
          const { error: uploadError } =
            await supabase.storage
              .from("pastpapers")
              .upload(
                fileName,
                file.buffer,
                {
                  contentType: file.mimetype,
                  upsert: false,
                }
              );

          if (uploadError) {
            throw uploadError;
          }

          // Get public URL
          const {
            data: { publicUrl },
          } = supabase.storage
            .from("pastpapers")
            .getPublicUrl(fileName);

          // Save to Firestore
          await db.collection("pastPapers").add({
            name: paperName,
            fileName: cleanOriginalName,
            fileUrl: publicUrl,
            downloads: 0,
            createdAt: new Date().toISOString(),
          });

          uploaded.push({
            name: paperName,
            fileName: cleanOriginalName,
          });

        } catch (error) {
          console.log(
            `Failed to upload ${file.originalname}:`,
            error
          );

          failed.push({
            name: file.originalname,
            error: error.message,
          });
        }
      }

      return res.json({
        success: true,
        total: req.files.length,
        uploaded: uploaded.length,
        failed: failed.length,
        uploadedFiles: uploaded,
        failedFiles: failed,
      });

    } catch (error) {
      console.log(error);

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);


// ====================================
// UPLOAD PROFILE PHOTO
// ====================================
app.post(
  "/upload-profile-photo",
  upload.single("photo"),
  async (req, res) => {
    try {
      console.log("UPLOAD PROFILE PHOTO");

      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          error: "Missing userId",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No photo uploaded",
        });
      }

      const extension =
        req.file.originalname.split(".").pop();

      const fileName = `${uuidv4()}.${extension}`;

      const { error: uploadError } =
        await supabase.storage
          .from("profile-photos")
          .upload(fileName, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true,
          });

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage
        .from("profile-photos")
        .getPublicUrl(fileName);

      return res.json({
        success: true,
        photoUrl: publicUrl,
      });

    } catch (error) {
      console.log(error);

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ====================================
// UPLOAD SOCIAL MEDIA
// PHOTOS + VIDEOS
// ====================================

app.post(
  "/upload-social-media",
  upload.single("media"),
  async (req, res) => {
    try {
      console.log("====================================");
      console.log("UPLOAD SOCIAL MEDIA");

      const { userId, mediaType } = req.body;

      console.log("USER ID:", userId);
      console.log("MEDIA TYPE:", mediaType);

      if (!userId) {
        return res.status(400).json({
          error: "Missing userId",
        });
      }

      if (!mediaType) {
        return res.status(400).json({
          error: "Missing mediaType",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No media uploaded",
        });
      }

      // Only allow photos and videos
      if (
        mediaType !== "image" &&
        mediaType !== "video"
      ) {
        return res.status(400).json({
          error: "Invalid media type",
        });
      }

      // Get original extension
      const originalName =
        req.file.originalname || "media";

      const extension =
        originalName.includes(".")
          ? originalName.split(".").pop()
          : mediaType === "image"
          ? "jpg"
          : "mp4";

      // Put media into photos/ or videos/
      const folder =
        mediaType === "image"
          ? "photos"
          : "videos";

      const fileName =
        `${folder}/${uuidv4()}.${extension}`;

      console.log("UPLOADING:", fileName);

      const { error: uploadError } =
        await supabase.storage
          .from("social-media")
          .upload(
            fileName,
            req.file.buffer,
            {
              contentType:
                req.file.mimetype,
              upsert: false,
            }
          );

      if (uploadError) {
        console.log(
          "SUPABASE UPLOAD ERROR:",
          uploadError
        );

        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage
        .from("social-media")
        .getPublicUrl(fileName);

      console.log(
        "SOCIAL MEDIA UPLOAD SUCCESSFUL"
      );

      console.log(
        "PUBLIC URL:",
        publicUrl
      );

      return res.json({
        success: true,
        mediaUrl: publicUrl,
        mediaType,
        fileName,
      });

    } catch (error) {
      console.log(
        "SOCIAL MEDIA UPLOAD ERROR:",
        error
      );

      return res.status(500).json({
        error:
          error.message ||
          "Social media upload failed",
      });
    }
  }
);



// ====================================
// LEMON SQUEEZY CREATE CHECKOUT
// ====================================

app.post(
  "/create-lemon-checkout",
  async (req, res) => {
    try {
      const { userId, plan } = req.body;

      console.log(
        "===================================="
      );
      console.log(
        "LEMON SQUEEZY CHECKOUT REQUEST"
      );
      console.log("USER ID:", userId);
      console.log("PLAN:", plan);

      if (!userId) {
        return res.status(400).json({
          error: "Missing userId",
        });
      }

      // ====================================
      // SELECT VARIANT
      // ====================================

      let variantId;

      if (plan === "weekly") {
        variantId =
          process.env.LEMON_WEEK_VARIANT_ID;
      } else if (plan === "monthly") {
        variantId =
          process.env.LEMON_MONTH_VARIANT_ID;
      } else {
        return res.status(400).json({
          error: "Invalid Premium plan",
        });
      }

      if (!variantId) {
        return res.status(500).json({
          error:
            "Lemon Squeezy variant ID is missing",
        });
      }

      // ====================================
      // CREATE CHECKOUT
      // ====================================

      const response = await axios.post(
        "https://api.lemonsqueezy.com/v1/checkouts",
        {
          data: {
            type: "checkouts",

            attributes: {
              checkout_data: {
                custom: {
                  user_id: userId,
                  plan: plan,
                },
              },
            },

            relationships: {
              store: {
                data: {
                  type: "stores",
                  id:
                    process.env
                      .LEMON_SQUEEZY_STORE_ID,
                },
              },

              variant: {
                data: {
                  type: "variants",
                  id: variantId,
                },
              },
            },
          },
        },

        {
          headers: {
            Authorization:
              `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,

            "Content-Type":
              "application/vnd.api+json",

            Accept:
              "application/vnd.api+json",
          },
        }
      );

      const checkoutUrl =
        response.data?.data?.attributes?.url;

      if (!checkoutUrl) {
        throw new Error(
          "Lemon Squeezy did not return checkout URL"
        );
      }

      console.log(
        "LEMON CHECKOUT CREATED"
      );

      return res.json({
        success: true,
        url: checkoutUrl,
      });

    } catch (error) {
      console.log(
        "===================================="
      );

      console.log(
        "LEMON CHECKOUT ERROR"
      );

      console.log(
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        error:
          "Checkout creation failed",
      });
    }
  }
);


// ====================================
// LEMON SQUEEZY WEBHOOK
// ====================================

app.post(
  "/lemon-webhook",
  async (req, res) => {
    try {
      console.log(
        "===================================="
      );

      console.log(
        "LEMON SQUEEZY WEBHOOK RECEIVED"
      );

      const signature =
        req.headers["x-signature"];

      const rawBody =
        req.rawBody;

      if (!rawBody) {
        console.log(
          "MISSING RAW BODY"
        );

        return res.status(400).json({
          error: "Missing raw body",
        });
      }

      if (!signature) {
        console.log(
          "MISSING WEBHOOK SIGNATURE"
        );

        return res.status(401).json({
          error:
            "Missing webhook signature",
        });
      }

      // ====================================
      // VERIFY SIGNATURE
      // ====================================

      const expectedSignature =
        crypto
          .createHmac(
            "sha256",
            process.env.LEMON_WEBHOOK_SECRET
          )
          .update(rawBody)
          .digest("hex");

      if (
        signature !== expectedSignature
      ) {
        console.log(
          "INVALID LEMON SIGNATURE"
        );

        return res.status(401).json({
          error:
            "Invalid signature",
        });
      }

      // ====================================
      // PARSE EVENT
      // ====================================

      const event =
        JSON.parse(
          rawBody.toString()
        );

      const eventName =
        event.meta?.event_name;

      console.log(
        "EVENT:",
        eventName
      );

      // ====================================
      // ONLY PROCESS ORDER CREATED
      // ====================================

      if (
        eventName !== "order_created"
      ) {
        console.log(
          "EVENT IGNORED:",
          eventName
        );

        return res.json({
          received: true,
        });
      }

      // ====================================
      // GET CUSTOM DATA
      // ====================================

      const customData =
        event.meta?.custom_data;

      const userId =
        customData?.user_id;

      const plan =
        customData?.plan;

      console.log(
        "USER ID:",
        userId
      );

      console.log(
        "PLAN:",
        plan
      );

      // ====================================
      // VALIDATE CUSTOM DATA
      // ====================================

      if (!userId || !plan) {
        console.log(
          "MISSING USER ID OR PLAN"
        );

        return res.status(400).json({
          error:
            "Missing custom payment data",
        });
      }

      if (
        !["weekly", "monthly"].includes(
          plan
        )
      ) {
        console.log(
          "INVALID PREMIUM PLAN"
        );

        return res.status(400).json({
          error:
            "Invalid Premium plan",
        });
      }

      // ====================================
      // ACTIVATE PREMIUM
      // ====================================

      console.log(
        "ACTIVATING PREMIUM"
      );

      await activatePremium(
        userId,
        plan
      );

      console.log(
        "LEMON PREMIUM ACTIVATED"
      );

      return res.json({
        received: true,
      });

    } catch (error) {
      console.log(
        "LEMON WEBHOOK ERROR:",
        error.message
      );

      return res.status(500).json({
        error:
          "Webhook processing failed",
      });
    }
  }
);


// ====================================
// START SERVER
// ====================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("SERVER RUNNING ON PORT", PORT);
});