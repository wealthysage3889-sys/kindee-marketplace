const Store = require("../models/Store");
const User = require("../models/User");

async function seedDefaultStore() {
  try {
    const storeCount = await Store.countDocuments();
    if (storeCount > 0) return;

    const seller =
      (await User.findOne({ role: "seller", isActive: { $ne: false } })) ||
      (await User.findOne({ role: "admin", isActive: { $ne: false } })) ||
      (await User.findOne({ role: "owner", isActive: { $ne: false } }));

    if (!seller) {
      console.log("[seedDefaultStore] No seller/admin/owner user found, skip store seeding.");
      return;
    }

    await Store.create({
      owner: seller._id,
      name: seller.name ? `${seller.name} Shop` : "Admin Shop",
      description: "ร้านค้าเริ่มต้น",
      email: seller.email || undefined,
      phone: seller.phone || undefined,
      isActive: true,
      isVerified: true,
    });

    console.log(`[seedDefaultStore] Created default store for ${seller.email || seller._id}`);
  } catch (error) {
    console.error("[seedDefaultStore] Failed:", error.message);
  }
}

module.exports = seedDefaultStore;
