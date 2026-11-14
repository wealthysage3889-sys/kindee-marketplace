require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const mongoose = require("mongoose");
const User = require("./models/User");
const Store = require("./models/Store");
const Product = require("./models/Product");

const fixReferences = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB_NAME,
    });
    console.log("MongoDB Connected");

    // Find the current admin
    const admin = await User.findOne({ email: "admin.shop@kindee.com" });
    if (!admin) {
      console.error("Admin not found. Run seedAdmin.js first.");
      process.exit(1);
    }
    const adminId = admin._id;
    console.log(`Admin ID: ${adminId}`);

    // Find orphaned stores (owner not pointing to any existing user)
    const allStores = await Store.find({});
    let fixedStores = 0;
    for (const store of allStores) {
      const ownerExists = await User.exists({ _id: store.owner });
      if (!ownerExists) {
        store.owner = adminId;
        await store.save();
        fixedStores++;
        console.log(`  Fixed store: ${store.name} (${store._id}) -> owner ${adminId}`);
      }
    }
    console.log(`Stores: ${allStores.length} total, ${fixedStores} fixed`);

    // Find orphaned products (seller not pointing to any existing user)
    const allProducts = await Product.find({});
    let fixedProducts = 0;
    for (const product of allProducts) {
      const sellerExists = await User.exists({ _id: product.seller });
      if (!sellerExists) {
        product.seller = adminId;
        await product.save();
        fixedProducts++;
        console.log(`  Fixed product: ${product.name} (${product._id}) -> seller ${adminId}`);
      }
    }
    console.log(`Products: ${allProducts.length} total, ${fixedProducts} fixed`);

    console.log("Done!");
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB Disconnected");
  }
};

fixReferences();