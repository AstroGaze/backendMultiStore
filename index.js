// backend/index.js
const express = require("express");
const dotenv = require("dotenv");
const {
  searchMockStoreA,
  searchMockStoreB,
} = require("./scrapers/mockStoreScraper");
const { searchMercadoLibre } = require("./scrapers/mercadoLibreScraper"); // <-- IMPORT NEW SCRAPER
const { searchCyberpuerta } = require("./scrapers/cyberpuertaScraper"); // Uncomment if you want to use Cyberpuerta scraper

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Price Comparison API Backend is running!");
});

const storeScrapers = {
  mercadolibre: searchMercadoLibre,
  cyberpuerta: searchCyberpuerta, // <-- ADD NEW SCRAPER
};

app.get("/api/stores", (req, res) => {
  res.json(Object.keys(storeScrapers));
});

app.get("/api/search", async (req, res) => {
  const { product_name, stores } = req.query;

  if (!product_name) {
    return res.status(400).json({ error: "Product name is required" });
  }

  let activeScrapersPromises = [];
  const storesToQuery = [];

  if (stores) {
    const requestedStores = stores
      .split(",")
      .map((s) => s.trim().toLowerCase()); // Normalize to lowercase
    requestedStores.forEach((storeKey) => {
      if (storeScrapers[storeKey]) {
        activeScrapersPromises.push(storeScrapers[storeKey](product_name));
        storesToQuery.push(storeKey);
      } else {
        console.warn(`Unknown store key: ${storeKey}`);
      }
    });
  } else {
    // If no specific stores requested, use all
    Object.keys(storeScrapers).forEach((storeKey) => {
      activeScrapersPromises.push(storeScrapers[storeKey](product_name));
      storesToQuery.push(storeKey);
    });
  }

  if (activeScrapersPromises.length === 0) {
    return res
      .status(400)
      .json({ error: "No valid stores selected or available for search." });
  }

  console.log(
    `Searching for: "${product_name}" across ${storesToQuery.join(", ")}.`
  );

  try {
    const results = await Promise.allSettled(activeScrapersPromises);
    const allProductData = [];

    results.forEach((result, index) => {
      const storeKey = storesToQuery[index]; // Get the store key for context
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        // Add storeKey to each product for easier identification on frontend
        const productsWithStoreKey = result.value.map((p) => ({
          ...p,
          storeKey,
        }));
        allProductData.push(...productsWithStoreKey);
      } else if (result.status === "rejected") {
        console.error(`Scraper for ${storeKey} failed:`, result.reason);
        // Optionally, include error info in the response for specific stores
        // e.g., allProductData.push({ storeKey, error: 'Failed to fetch data', details: result.reason.message });
      } else {
        // Handle cases where result.value is not an array (shouldn't happen with current design)
        console.warn(
          `Scraper for ${storeKey} returned an unexpected result:`,
          result.value
        );
      }
    });

    allProductData.sort(
      (a, b) => (a.price || Infinity) - (b.price || Infinity)
    ); // Sort by price, handle missing price

    res.json(allProductData);
  } catch (error) {
    console.error("Error during search orchestration:", error);
    res.status(500).json({
      error: "Failed to fetch product prices due to an internal error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
