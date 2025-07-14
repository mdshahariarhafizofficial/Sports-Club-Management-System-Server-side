const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

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
    await client.connect();
    const db = client.db('sports-club');

    const usersCollection = db.collection('users');
    const courtsCollection = db.collection('courts');
    const bookingsCollection = db.collection('bookings');
    const paymentsCollection = db.collection('payments');
    const couponsCollection = db.collection('coupons');
    const announcementsCollection = db.collection('announcements');    

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
    app.get('/users', async(req, res) => {
        const { search, email } = req.query;
        const query = {};
         if (email) {
            query.email = email;
         }

        else if(search){
            query = {
                $or: [
                    { name: { $regex: search, $option: 'i' }},
                    { email: { $regex: search, $option: 'i' }},
                ]
            };
        };
        const users = await usersCollection.find(query).toArray();
        res.send(users)
    })

    // ------------- All Bookings API --------------
    // Post Booking
    app.post('/bookings', async(req, res) => {
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
    app.get('/bookings', async(req, res)=>{
      const {email, status} = req.query;

      const query = {};
      if (email) {
        query.userEmail = email;
      };
      if (status) {
        query.status=status;
      };

      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    // Update Booking Status
// Update Booking Status + Promote User to Member if approved
app.patch('/bookings/:id', async (req, res) => {
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
    app.delete('/bookings/:id', async(req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(filter);
      res.send(result);
    })

    // ---------- All Courts API here -----------------
    // Post Courts
    app.post('/courts', async(req, res) => {
      const courtData = req.body;
      const result = await courtsCollection.insertOne(courtData);
      res.send(result)
    })

    // Get Courts
    app.get('/courts', async(req, res) => {
      const result = await courtsCollection.find().toArray();
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    // Example test route
    app.get('/', (req, res) => {
      res.send('SCMS Server is Running');
    });

  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
