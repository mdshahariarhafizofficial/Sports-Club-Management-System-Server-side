const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
var admin = require("firebase-admin");

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Firebase Setup
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
var serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// MongoDB Setup
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // await client.connect();
    const db = client.db('sports-club');

    const usersCollection = db.collection('users');
    const courtsCollection = db.collection('courts');
    const bookingsCollection = db.collection('bookings');
    const paymentsCollection = db.collection('payments');
    const couponsCollection = db.collection('coupons');
    const announcementsCollection = db.collection('announcements');
    const ratingsCollection = db.collection('ratings');    

    // ----------------- Custom Middleware --------------
    
    // FB Token Verify
    const verifyFBToken = async (req, res, next) => {
      const token = req?.headers?.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).send({message: 'unauthorized Access!'});
      }

      try{
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next()
      }
      catch(error) {
        return res.status(403).send({ message: 'forbidden access' })
      }
    }

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({email});
      if (user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    }


    // --------------Users All API Here-------------
    app.post('/users', async (req, res) => {
        const userInfo = req.body;
        const {email} = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

          const existingUser = await usersCollection.findOne({ email });

            if (existingUser) {
                return res.status(200).json({ message: 'User already exists' });
            }

        const result = await usersCollection.insertOne(userInfo);
        res.send(result);
    });

    // ------------Get User--------
    app.get('/users', verifyFBToken, async(req, res) => {
        const { search, email } = req.query;
        let query = {};
         if (email) {
            query.email = email;
         }

        else if(search){
            query = {
                $or: [
                    { name: { $regex: search, $options: 'i' }},
                    { email: { $regex: search, $options: 'i' }},
                ]
            };
        };
        const users = await usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
        res.send(users)
    });

    // Get User Role
    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await usersCollection
      .findOne({email});

      if (!user) {
         return res.status(404).send({ message: "User not found" });
      }

      res.send({ role: user.role || "user" })
    })

    // Members API
    app.get('/members', verifyFBToken, verifyAdmin, async (req, res) => {
      const {search} = req.query;
      const query = {
        role: 'member',
        ...(search && {
          name: {$regex: search, $options: "i"}
        }),
      };      
      const members = await usersCollection
      .find(query)
      .sort({ memberSince: -1 })
      .toArray();
      res.send(members);

    });

    // Delete Member
    app.delete('/members/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({_id: new ObjectId(id)});
      res.send(result);
    })

    // ------------- All Bookings API --------------
    // Post Booking
    app.post('/bookings', verifyFBToken, async(req, res) => {
      const booking = req.body;

        // Validation
        const requiredFields = ['userEmail', 'courtId', 'courtTitle', 'courtType', 'date', 'slots', 'price'];
        const missingField = requiredFields.find(field => !booking[field]);

        if (missingField) {
          return res.status(400).json({ message: `Missing field: ${missingField}` });
        }

        booking.status = 'pending';
        booking.createdAt = new Date().toISOString();

      const result = await bookingsCollection.insertOne(booking);
      res.send(result)
    });

    // Get bookings
    app.get('/bookings', verifyFBToken, async(req, res)=>{
      const {email, status,search} = req.query;

      let query = {};
      if (email) {
        query.userEmail = email;
      };
      if (status) {
        query.status=status;
      };
      if (search) {
            query = {
            courtTitle: { $regex: search, $options: 'i' }
            };
      }

      const result = await bookingsCollection
      .find(query)
      .sort({ date: -1 })
      .toArray();
      res.send(result);
    });

    // Get single Booking
    app.get('/bookings/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.findOne({_id: new ObjectId(id)});
      res.send(result)
    })

    // Update Booking Status
// Update Booking Status + Promote User to Member if approved
app.patch('/bookings/:id', verifyFBToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { status, email } = req.body;

  const filter = { _id: new ObjectId(id) };
  const updatedDocs = {
    $set: { status }
  };

  const result = await bookingsCollection.updateOne(filter, updatedDocs);

  // If approved, promote user to member
  if (status === 'approved') {
    const updateUserRole = {
      $set: {
        role: 'member',
        memberSince: new Date().toISOString(),
      }
    };

    const userResult = await usersCollection.updateOne(
      { email },
      updateUserRole
    );

    return res.send({
      bookingUpdate: result,
      userUpdate: userResult,
    });
  }

  res.send(result);
});


    // Delete Bookings
    app.delete('/bookings/:id', verifyFBToken, async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(filter);
      res.send(result);
    })

    // ---------- All Courts API here -----------------

    // Courts Count
    app.get('/courtsCount', async(req, res) => {
      const result = await courtsCollection.estimatedDocumentCount();
      res.send({totalCourtsCount: result})
    })

    // Post Courts
    app.post('/courts', verifyFBToken, verifyAdmin, async(req, res) => {
      const courtData = req.body;
      const result = await courtsCollection.insertOne(courtData);
      res.send(result)
    })

    // Get Courts
    app.get('/courts', async(req, res) => {
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const search = req.query.search;
      const type = req.query.type;
      const slot = req.query.slot;
      const sort = req.query.sort;

      let query = {};
      
      if (search) {
        query = {
          name: {$regex: search, $options: "i"}}
      }

      if (type) {
        query.type = type;
      }
      
      if (slot) {
        if (slot === "Morning") {
          query.slots = { $elemMatch: { $regex: 'AM$', $options: 'i' } };
        }
        else if (slot === "Afternoon") {
        query.slots = { $elemMatch: { $regex: '^1|2|3|4:.*PM$' } };
        }
        else if (slot === "Evening") {
        query.slots = { $elemMatch: { $regex: '^5|6|7|8|9:.*PM$' } };
        }
      }

      let sortOption = {};
      if (sort === 'LowToHigh') {
        sortOption.pricePerSession = 1;
      }else if(sort === 'HighToLow'){
        sortOption.pricePerSession = -1;
      }

      const result = await courtsCollection
      .find(query)
      .sort(sortOption)
      .skip(page * size)
      .limit(size)
      .toArray();
      res.send(result);
    })

    // Update Courts
    app.patch('/courts/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = {_id: new ObjectId(id)};
      const updateData = req.body;
      const updatedDocs = {
        $set: updateData,
      }
      const result = await courtsCollection.updateOne(filter, updatedDocs);
      res.send(result)
    });

    // Delete Courts
    app.delete('/courts/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await courtsCollection.deleteOne({_id: new ObjectId(id)});
      res.send(result);
    })

    // ---------- Coupons All API here -------------

    // Post
    app.post('/coupons', verifyFBToken, verifyAdmin, async(req, res) => {
      const couponData = req.body;
      const result = await couponsCollection.insertOne(couponData);
      res.send(result)
    })

    // Get Coupons
    app.get('/coupons', async (req, res) => {
      const result = await couponsCollection
      .find()
      .toArray();
      res.send(result)
    })

    // Update Api
    app.patch('/coupons/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDocs = {
        $set: updateData
      };
      const result = await couponsCollection.updateOne(filter, updatedDocs);
      res.send(result)
    });

    // Delete
    app.delete('/coupons/:id', verifyFBToken, verifyAdmin, async(req, res) => {
      const id = req.params.id;
      const result = await couponsCollection.deleteOne({_id: new ObjectId(id)});
      res.send(result);
    })

    // Validate Coupon
    app.post('/validate-coupon', verifyFBToken, async (req, res) => {
      const {code} = req.body;

      const coupon = await couponsCollection.findOne({code});

      if (!coupon) {
        return res.send({ valid: false });
      }

      return res.send({
      valid: true,
      discountAmount: coupon.discountAmount,
    });

    });


  // ---------------- Payments Api here ------------

// Create Payment Intent API
app.post('/create-payment-intent', verifyFBToken, async (req, res) => {
  try {
    const { price } = req.body;

    // Validate price
    if (!price || price <= 0) {
      return res.status(400).send({ error: 'Invalid price' });
    }

    // Convert to smallest currency unit (৳ → poisha)
    const amount = parseInt(price * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'bdt', // or 'usd' depending on your currency
      payment_method_types: ['card'],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).send({ error: 'Failed to create payment intent' });
  }
});

// Payment History

// Post
app.post('/payments', verifyFBToken, async(req, res) => {
  const paymentData = req.body;
  paymentData.status = "paid";

  const result = await paymentsCollection.insertOne(paymentData);

  // update Booking Status
  const bookingId = paymentData.bookingId;
  const filter = {_id: new ObjectId(bookingId)};
  const update = {$set: {status: 'confirmed'}};
  const bookingResult = await bookingsCollection.updateOne(filter, update);

  res.send(result, bookingResult) 
});

// Get Payments History
app.get('/payments', verifyFBToken, async (req, res) => {
  const { email } = req.query;
  const payments = await paymentsCollection
  .find({ email })
  .sort({ date: -1 })
  .toArray();
  res.send(payments);
});


    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

// Get counter Data
app.get('/admin-stats', verifyFBToken, verifyAdmin, async(req, res) => {
  const email = req.query.email;
  const user = await usersCollection.findOne({email});

  if (user?.role !== 'admin') {
     return res.status(403).send({ message: 'forbidden' });
  }

  const totalCourts = await courtsCollection.estimatedDocumentCount();
  const totalUsers = await usersCollection.estimatedDocumentCount();
  const totalMembers = await usersCollection.countDocuments({role: 'member'});
  res.send({ totalCourts, totalUsers, totalMembers });
});

// ---------- Announcements API ------------

// POST API
app.post('/announcements', verifyFBToken, verifyAdmin, async(req, res) => {
  const data = req.body;
  const result = await announcementsCollection.insertOne(data);
  res.send(result);
})

// GET API
app.get('/announcements', verifyFBToken, async(req, res) => {
  const result = await announcementsCollection
  .find()
  .sort({ postAt: -1 })
  .toArray();
  res.send(result);
});

// Patch API
app.patch('/announcements/:id', verifyFBToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const updateData = req.body;
  const filter = {_id: new ObjectId(id)};
  const updatedDocs = {
    $set: updateData,
  };

  const result = await announcementsCollection.updateOne(filter, updatedDocs);
  res.send(result)
});

// Delete API
app.delete('/announcements/:id', verifyFBToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await announcementsCollection.deleteOne({_id: new ObjectId(id)});
  res.send(result)
});

// ---------------- Ratings Api here ------------
app.post('/ratings', verifyFBToken, async (req, res) => {
  const newRating = req.body;
  newRating.createdAt = new Date();

  const result = await ratingsCollection.insertOne(newRating);
  res.send(result);
});

// Get Api
app.get('/ratings', async (req, res) => {
  const courtId = req.query.courtId;
  const email = req.query.email;
  let query = {};
  
  if (courtId) {
    query.courtId = courtId;
  }
  
  if (email) {
   query.userEmail = email;
  }

  const result = await ratingsCollection.find(query).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

// Patch Api
app.patch('/ratings/:id', verifyFBToken, async (req, res) => {
  const id = req.params.id;
  const updatedRating = req.body;

  const result = await ratingsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedRating }
  );
  res.send(result);
});

// Delete Api
app.delete('/ratings/:id', verifyFBToken, async (req, res) => {
  const id = req.params.id;
  const result = await ratingsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});


// Example test route
    app.get('/', (req, res) => {
      res.send('SCMS Server is Running');
    });


// Aggregation Code
app.get("/popular-courts", async (req, res) => {
  try {
    const result = await ratingsCollection.aggregate([
      {
        $group: {
          _id: "$courtId", // this is a string
          averageRating: { $avg: "$rating" },
          totalRatings: { $sum: 1 },
        },
      },
      {
        $sort: { averageRating: -1, totalRatings: -1 },
      },
      {
        $limit: 6,
      },
      {
        $addFields: {
          courtObjectId: { $toObjectId: "$_id" }, // convert courtId string to ObjectId
        },
      },
      {
        $lookup: {
          from: "courts",
          localField: "courtObjectId",
          foreignField: "_id",
          as: "courtDetails",
        },
      },
      {
        $unwind: "$courtDetails",
      },
      {
        $project: {
          _id: "$courtDetails._id",
          name: "$courtDetails.name",
          type: "$courtDetails.type",
          image: "$courtDetails.image",
          location: "$courtDetails.location",
          pricePerSession: "$courtDetails.pricePerSession",
          averageRating: 1,
          totalRatings: 1,
        },
      },
    ]).toArray();

    res.send(result);
  } catch (error) {
    console.error("Error fetching popular courts:", error);
    res.status(500).send({ error: "Failed to fetch popular courts" });
  }
});

app.get("/popular-courts", async (req, res) => {
  try {
    const result = await ratingsCollection.aggregate([
      {
        $group: {
          _id: "$courtId",
          averageRating: { $avg: "$rating" },
          totalRatings: { $sum: 1 },
        },
      },
      {
        $sort: { averageRating: -1, totalRatings: -1 },
      },
      {
        $limit: 10,
      },
      {
        $lookup: {
          from: "courts",
          localField: "_id",
          foreignField: "_id",
          as: "courtDetails",
        },
      },
      {
        $unwind: "$courtDetails",
      },
      {
        $project: {
          _id: "$courtDetails._id",
          name: "$courtDetails.name",
          type: "$courtDetails.type",
          image: "$courtDetails.image",
          location: "$courtDetails.location",
          pricePerSession: "$courtDetails.pricePerSession",
          averageRating: 1,
          totalRatings: 1,
        },
      },
    ]).toArray();

    res.send(result);
  } catch (error) {
    console.error("Error fetching popular courts:", error);
    res.status(500).send({ error: "Failed to fetch popular courts" });
  }
});



// -------------------------------------
  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
