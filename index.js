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
// ACTIVATE PREMIUM  (FIXED)
// ====================================
const activatePremium = async (userId, plan) => {
  try {
    console.log("ACTIVATING PREMIUM...");
    console.log("USER ID:", userId);
    console.log("PLAN:", plan);

    let premiumUntil = new Date();

    if (plan === "2days") {
      premiumUntil.setDate(premiumUntil.getDate() + 2);
    }

    if (plan === "weekly") {
      premiumUntil.setDate(premiumUntil.getDate() + 7);
    }

    if (plan === "monthly") {
      premiumUntil.setMonth(premiumUntil.getMonth() + 1);
    }

    console.log("WRITING TO FIRESTORE...");

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
// MPESA TOKEN (HARD DEBUG VERSION)
// ====================================
const getMpesaAccessToken = async () => {
  try {
    console.log("====================================");
    console.log("===== MPESA ENV DEBUG =====");

    // CHECK IF ENV VARIABLES EXIST
    console.log(
      "MPESA_CONSUMER_KEY EXISTS:",
      !!process.env.MPESA_CONSUMER_KEY
    );

    console.log(
      "MPESA_CONSUMER_SECRET EXISTS:",
      !!process.env.MPESA_CONSUMER_SECRET
    );

    // CHECK LENGTHS (helps detect broken .env)
    console.log(
      "MPESA_CONSUMER_KEY LENGTH:",
      process.env.MPESA_CONSUMER_KEY?.length
    );

    console.log(
      "MPESA_CONSUMER_SECRET LENGTH:",
      process.env.MPESA_CONSUMER_SECRET?.length
    );

    console.log("REQUESTING MPESA ACCESS TOKEN...");

    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");

    console.log("AUTH GENERATED SUCCESSFULLY");

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    console.log("TOKEN RECEIVED SUCCESSFULLY");
    console.log("ACCESS TOKEN:", response.data.access_token);

    return response.data.access_token;

  } catch (error) {
    console.log("====================================");
    console.log("TOKEN ERROR OCCURRED");

    if (error.response) {
      console.log("SAFARICOM TOKEN ERROR RESPONSE:");
      console.log(error.response.data);
    } else {
      console.log("ERROR MESSAGE:");
      console.log(error.message);
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

  return { password, timestamp };
};


// ====================================
// MPESA PAYMENT (DEBUG VERSION)
// ====================================
app.post("/mpesa-payment", async (req, res) => {
  console.log("====================================");
  console.log("MPESA ROUTE HIT");

  try {
    const { phone, amount, userId, plan } = req.body;

    // LOG EVERYTHING COMING FROM APP
    console.log("BODY:", req.body);
    console.log("PHONE:", phone);
    console.log("AMOUNT:", amount);
    console.log("USER ID:", userId);
    console.log("PLAN:", plan);

    // VALIDATION
    if (!phone || !amount || !userId || !plan) {
      console.log("MISSING REQUIRED FIELDS");

      return res.status(400).json({
        error: "Missing phone, amount, userId or plan",
      });
    }

    console.log("GETTING MPESA ACCESS TOKEN...");

    const accessToken = await getMpesaAccessToken();

    console.log("ACCESS TOKEN SUCCESS");

    const { password, timestamp } = generateMpesaPassword();

    console.log("PASSWORD GENERATED");
    console.log("TIMESTAMP:", timestamp);

    console.log("SENDING STK PUSH TO SAFARICOM...");

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: "UniversityUniversal",
        TransactionDesc: "Premium Subscription",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    console.log("STK PUSH RESPONSE:");
    console.log(response.data);

    console.log("SAVING PENDING PAYMENT...");

    await db
      .collection("mpesa_pending")
      .doc(response.data.CheckoutRequestID)
      .set({
        userId,
        plan,
        phone,
        amount,
        createdAt: new Date().toISOString(),
      });

    console.log("PENDING PAYMENT SAVED SUCCESSFULLY");

    return res.json({
      success: true,
      data: response.data,
    });

  } catch (error) {
  console.log("====================================");
  console.log("MPESA ERROR OCCURRED");
  console.log("FULL ERROR OBJECT:");

  if (error.response) {
    console.log("STATUS:", error.response.status);

    console.log(
      "DATA:",
      JSON.stringify(error.response.data, null, 2)
    );

    console.log(
      "HEADERS:",
      JSON.stringify(error.response.headers, null, 2)
    );
  } else {
    console.log("MESSAGE:", error.message);
  }

  return res.status(500).json({
    error: "M-Pesa payment failed",
    status: error.response?.status,
    details: error.response?.data || error.message,
  });
}
});

// ====================================
// MPESA CALLBACK
// ====================================
app.post("/mpesa-callback", async (req, res) => {
  try {
    const callback = req.body.Body.stkCallback;
    const checkoutId = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    console.log("MPESA CALLBACK HIT");

    if (resultCode !== 0) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const pendingRef = db.collection("mpesa_pending").doc(checkoutId);
    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const { userId, plan } = pendingDoc.data();

    await activatePremium(userId, plan);
    await pendingRef.delete();

    res.json({
      ResultCode: 0,
      ResultDesc: "Success",
    });

  } catch (error) {
    console.log("CALLBACK ERROR:", error.message);

    res.json({
      ResultCode: 0,
      ResultDesc: "Error handled",
    });
  }
});


// ====================================
// EXPIRE PREMIUM DAILY (FIXED)
// ====================================
cron.schedule("0 0 * * *", async () => {
  try {
    const users = await db.collection("users").get();
    const now = new Date();

    for (const doc of users.docs) {
      const user = doc.data();

      if (user.isPremium && user.premiumUntil) {
        const expiry = new Date(user.premiumUntil);

        if (now > expiry) {
          await db.collection("users").doc(doc.id).set(
            {
              isPremium: false,
              premiumUntil: null,
            },
            { merge: true }
          );
        }
      }
    }

    console.log("PREMIUM CLEANUP DONE");

  } catch (error) {
    console.log("CRON ERROR:", error.message);
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

app.post("/create-lemon-checkout", async (req, res) => {

  try {

    const { userId, plan } = req.body;

    console.log("LEMON CHECKOUT REQUEST");
    console.log(userId, plan);


    let variantId;


    if (plan === "2days") {
      variantId = process.env.LEMON_2DAY_VARIANT_ID;
    }


    if (plan === "weekly") {
      variantId = process.env.LEMON_WEEK_VARIANT_ID;
    }


    if (plan === "monthly") {
      variantId = process.env.LEMON_MONTH_VARIANT_ID;
    }


    if (!variantId) {
      return res.status(400).json({
        error:"Invalid plan"
      });
    }



    const response = await axios.post(

      "https://api.lemonsqueezy.com/v1/checkouts",

      {
        data:{
          type:"checkouts",

          attributes:{

            checkout_data:{
              custom:{
                user_id:userId,
                plan:plan
              }
            }

          },

          relationships:{
            store:{
              data:{
                type:"stores",
                id:process.env.LEMON_SQUEEZY_STORE_ID
              }
            },

            variant:{
              data:{
                type:"variants",
                id:variantId
              }
            }
          }
        }

      },


      {

        headers:{

          Authorization:
          `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,

          "Content-Type":"application/vnd.api+json",

          Accept:
          "application/vnd.api+json"

        }

      }

    );


    res.json({

      url:
      response.data.data.attributes.url

    });



  } catch(error){

    console.log(
      "LEMON CHECKOUT ERROR",
      error.response?.data || error.message
    );


    res.status(500).json({
      error:"Checkout creation failed"
    });

  }

});


// ====================================
// LEMON SQUEEZY WEBHOOK
// ====================================

app.post("/lemon-webhook", async (req, res) => {

try{


console.log("LEMON WEBHOOK RECEIVED");


const signature = req.headers["x-signature"];

const rawBody = req.rawBody;

if (!rawBody) {
  console.log("Missing raw body");

  return res.status(400).json({
    error: "Missing raw body",
  });
}

const expectedSignature = crypto
  .createHmac("sha256", process.env.LEMON_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");

if (signature !== expectedSignature) {
  console.log("INVALID LEMON SIGNATURE");

  return res.status(401).json({
    error: "Invalid signature",
  });
}

const event = JSON.parse(rawBody.toString());


const order = event.data.attributes;


if(
event.meta.event_name === "order_created"
){


const userId =
event.meta.custom_data?.user_id;

const plan =
event.meta.custom_data?.plan;



console.log(
"ACTIVATING:",
userId,
plan
);



await activatePremium(
userId,
plan
);


}



res.json({
received:true
});


}catch(error){


console.log(
"LEMON WEBHOOK ERROR",
error.message
);


res.status(500).json({
error:error.message
});


}


});


// ====================================
// START SERVER
// ====================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("SERVER RUNNING ON PORT", PORT);
});