// backend/index.js
const express = require("express");
const dotenv = require("dotenv");
const {
  searchMockStoreA,
  searchMockStoreB,
} = require("./scrapers/mockStoreScraper"); // Import mock scrapers

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Price Comparison API Backend is running!");
});

// --- List of available store scrapers ---
// We'll map store identifiers to their scraper functions
const storeScrapers = {
  storeA: searchMockStoreA,
  storeB: searchMockStoreB,
  // Add more real scrapers here later, e.g.:
  // 'mercadoLibre': searchMercadoLibre,
  // 'amazon': searchAmazon,
};

app.get("/api/stores", (req, res) => {
  res.json(Object.keys(storeScrapers));
});

// --- Search API Endpoint ---
app.get("/api/search", async (req, res) => {
  const { product_name, stores } = req.query;

  if (!product_name) {
    return res.status(400).json({ error: "Product name is required" });
  }

  let activeScrapers = [];
  if (stores) {
    const requestedStores = stores.split(",").map((s) => s.trim());
    activeScrapers = requestedStores
      .filter((storeKey) => storeScrapers[storeKey]) // Only use valid, configured stores
      .map((storeKey) => storeScrapers[storeKey](product_name));
  } else {
    // If no specific stores requested, use all
    activeScrapers = Object.values(storeScrapers).map((scraperFn) =>
      scraperFn(product_name)
    );
  }

  if (activeScrapers.length === 0) {
    return res
      .status(400)
      .json({ error: "No valid stores selected or available for search." });
  }

  console.log(
    `Searching for: "${product_name}" across ${activeScrapers.length} store interfaces.`
  );

  try {
    // Promise.allSettled waits for all promises to settle (either resolve or reject)
    const results = await Promise.allSettled(activeScrapers);

    const allProductData = [];
    results.forEach((result) => {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        allProductData.push(...result.value); // Spread the array of products from this scraper
      } else if (result.status === "rejected") {
        console.error("A scraper failed:", result.reason);
        // Optionally, you could include error info in the response for specific stores
      }
    });

    // Optional: Sort results by price, or group by product, etc.
    allProductData.sort((a, b) => a.price - b.price);

    res.json(allProductData);
  } catch (error) {
    // This catch is more for unexpected errors in the orchestration logic itself
    console.error("Error during search orchestration:", error);
    res
      .status(500)
      .json({
        error: "Failed to fetch product prices due to an internal error",
      });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
