// backend/index.js
const express = require("express");
const dotenv = require("dotenv");
const cron = require("node-cron");
const supabase = require("./lib/supabaseClient"); // Import your Supabase client

// Scrapers (ensure paths are correct)
const { searchMercadoLibre } = require("./scrapers/mercadoLibreScraper");
const { searchCyberpuerta } = require("./scrapers/cyberpuertaScraper");
// const { searchMockStoreA, searchMockStoreB } = require("./scrapers/mockStoreScraper"); // Keep if needed

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Price Comparison API Backend is running!");
});

// Store scraper functions map
const storeScrapers = {
  mercadolibre: searchMercadoLibre,
  cyberpuerta: searchCyberpuerta,
  // mockA: searchMockStoreA, // Example if using mocks
};

// === ON-DEMAND SEARCH API (existing functionality) ===
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
  const requestedStoreKeys = stores
    ? stores.split(",").map((s) => s.trim().toLowerCase())
    : Object.keys(storeScrapers);

  requestedStoreKeys.forEach((storeKey) => {
    if (storeScrapers[storeKey]) {
      activeScrapersPromises.push(storeScrapers[storeKey](product_name));
      storesToQuery.push(storeKey);
    } else {
      console.warn(`[API Search] Unknown store key: ${storeKey}`);
    }
  });

  if (activeScrapersPromises.length === 0) {
    return res
      .status(400)
      .json({ error: "No valid stores selected or available for search." });
  }

  console.log(
    `[API Search] Searching for: "${product_name}" across ${storesToQuery.join(
      ", "
    )}.`
  );

  try {
    const results = await Promise.allSettled(activeScrapersPromises);
    const allProductData = [];
    results.forEach((result, index) => {
      const storeKey = storesToQuery[index];
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        const productsWithStoreKey = result.value.map((p) => ({
          ...p,
          storeKey,
        }));
        allProductData.push(...productsWithStoreKey);
      } else if (result.status === "rejected") {
        console.error(
          `[API Search] Scraper for ${storeKey} failed:`,
          result.reason?.message || result.reason
        );
      }
    });

    const storePriority = ["mercadolibre", "cyberpuerta"];
    allProductData.sort((a, b) => {
      const aOrder =
        storePriority.indexOf(a.storeKey) !== -1
          ? storePriority.indexOf(a.storeKey)
          : storePriority.length;
      const bOrder =
        storePriority.indexOf(b.storeKey) !== -1
          ? storePriority.indexOf(b.storeKey)
          : storePriority.length;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.price || Infinity) - (b.price || Infinity);
    });

    res.json(allProductData);
  } catch (error) {
    console.error("[API Search] Error during search orchestration:", error);
    res.status(500).json({
      error: "Failed to fetch product prices due to an internal error",
    });
  }
});

// === SCHEDULED SCRAPING AND SUPABASE INTEGRATION ===

async function scrapeAndStoreProduct(queryTerm) {
  console.log(`[Scheduler] Starting scrape for query: "${queryTerm}"`);
  // ... (scraper execution logic remains the same up to allScrapedProducts) ...

  const scraperPromises = Object.keys(storeScrapers).map((storeKey) => {
    const scraperFn = storeScrapers[storeKey];
    return scraperFn(queryTerm)
      .then((products) =>
        products.map((p) => ({ ...p, storeKey, query_term: queryTerm }))
      )
      .catch((err) => {
        console.error(
          `[Scheduler] Scraper ${storeKey} failed for "${queryTerm}": ${err.message}`
        );
        return [];
      });
  });

  const results = await Promise.all(scraperPromises);
  const allScrapedProducts = results.flat();

  if (allScrapedProducts.length === 0) {
    console.log(`[Scheduler] No products found for query: "${queryTerm}"`);
    return;
  }

  console.log(
    `[Scheduler] Found ${allScrapedProducts.length} total product listings for "${queryTerm}". Processing for DB...`
  );

  for (const product of allScrapedProducts) {
    try {
      if (
        !product.productName ||
        !product.url ||
        !product.storeName ||
        product.price === undefined ||
        product.price === null
      ) {
        console.warn(
          `[Scheduler] Skipping product with missing critical data for "${queryTerm}":`,
          product.productName,
          product.url,
          product.storeName,
          product.price
        );
        continue;
      }

      console.log(
        `[Scheduler] Preparing to upsert listing. Query: "${queryTerm}", Store: "${product.storeName}", URL: "${product.url}", Name: "${product.productName}"`
      );

      // 1. Upsert product_listings
      let { data: listing, error: listingError } = await supabase
        .from("product_listings")
        .upsert(
          {
            tracked_product_query: queryTerm, // This comes from the tracked_products table
            store_name: product.storeName, // This comes from your scraper
            product_name_on_store: product.productName, // This comes from your scraper
            url: product.url, // THIS IS KEY for the ON CONFLICT
            image_url: product.imageUrl,
            last_updated_at: new Date().toISOString(),
          },
          {
            onConflict: "url,store_name", // This relies on url and store_name being consistent
          }
        )
        .select(
          "id, product_name_on_store, url, store_name, tracked_product_query"
        ) // Select more fields
        .single();

      if (listing) {
        console.log(
          `[Scheduler] Upsert result for listing: ID=${listing.id}, URL=${listing.url}, Store=${listing.store_name}, Query=${listing.tracked_product_query}`
        );
      }

      // 2. Check last price and insert into price_entries ONLY IF a change or new
      const { data: latestPriceEntry, error: latestPriceError } = await supabase
        .from("price_entries")
        .select("price, currency")
        .eq("listing_id", listing.id)
        .order("scraped_at", { ascending: false }) // Get the most recent
        .limit(1)
        .maybeSingle(); // Use maybeSingle as there might be no previous entry

      if (latestPriceError) {
        console.error(
          `[Scheduler] Error fetching latest price for ${listing.product_name_on_store} (ID: ${listing.id}):`,
          latestPriceError.message
        );
        // Decide if you want to proceed to insert the new price anyway or skip
        // For now, let's try to insert if fetching old price fails, as it might be the first price.
      }

      const scrapedPrice = parseFloat(product.price); // Ensure it's a number for comparison
      const scrapedCurrency = product.currency || "MXN";

      let shouldInsertPrice = true; // Assume we should insert by default

      if (latestPriceEntry) {
        // A previous price exists, compare it
        const previousPrice = parseFloat(latestPriceEntry.price);
        const previousCurrency = latestPriceEntry.currency;

        if (
          previousPrice === scrapedPrice &&
          previousCurrency === scrapedCurrency
        ) {
          shouldInsertPrice = false;
          // console.log(`[Scheduler] Price for ${listing.product_name_on_store} (ID: ${listing.id}) has not changed: ${scrapedPrice} ${scrapedCurrency}. Skipping price entry.`);
        } else {
          console.log(
            `[Scheduler] Price for ${listing.product_name_on_store} (ID: ${listing.id}) CHANGED from ${previousPrice} ${previousCurrency} to ${scrapedPrice} ${scrapedCurrency}.`
          );
        }
      } else {
        // No previous price entry, so this is the first one.
        console.log(
          `[Scheduler] First price entry for ${listing.product_name_on_store} (ID: ${listing.id}): ${scrapedPrice} ${scrapedCurrency}.`
        );
      }

      if (shouldInsertPrice) {
        const { error: insertPriceError } = await supabase
          .from("price_entries")
          .insert({
            listing_id: listing.id,
            price: scrapedPrice,
            currency: scrapedCurrency,
          });

        if (insertPriceError) {
          console.error(
            `[Scheduler] Error inserting new price for ${listing.product_name_on_store} (ID: ${listing.id}):`,
            insertPriceError.message
          );
        } else {
          console.log(
            `[Scheduler] Saved new price for ${listing.product_name_on_store} (ID: ${listing.id}): ${scrapedPrice} ${scrapedCurrency}`
          );
        }
      }
    } catch (e) {
      console.error(
        `[Scheduler] Unexpected error processing product ${product.productName} for DB: ${e.message}`
      );
    }
  }
  console.log(
    `[Scheduler] Finished processing DB entries for query: "${queryTerm}"`
  );
}

async function runScheduledScrapes() {
  console.log("[Scheduler] Starting scheduled scrape run...");
  const { data: trackedQueries, error } = await supabase
    .from("tracked_products")
    .select("query_term")
    .eq("is_active", true);

  if (error) {
    console.error("[Scheduler] Error fetching tracked products:", error);
    return;
  }

  if (!trackedQueries || trackedQueries.length === 0) {
    console.log("[Scheduler] No active products to track.");
    return;
  }

  for (const item of trackedQueries) {
    await scrapeAndStoreProduct(item.query_term);
    // Update last_scraped_at for the tracked product
    const { error: updateError } = await supabase
      .from("tracked_products")
      .update({ last_scraped_at: new Date().toISOString() })
      .eq("query_term", item.query_term);
    if (updateError) {
      console.error(
        `[Scheduler] Error updating last_scraped_at for ${item.query_term}:`,
        updateError.message
      );
    }
  }
  console.log("[Scheduler] Scheduled scrape run finished.");
}

// Schedule the task
// Example: Run every 4 hours - '0 */4 * * *'
// Example: Run once a day at 3 AM - '0 3 * * *'
// Example: Run every 30 minutes - '*/30 * * * *'
// For testing, run every 2 minutes: '*/2 * * * *'
cron.schedule(
  "0 */1 * * *",
  () => {
    // "At minute 0 past every 4th hour."
    console.log("[Scheduler] Cron job triggered by schedule.");
    runScheduledScrapes();
  },
  {
    scheduled: true,
    timezone: "America/Mexico_City", // Important: Set your timezone
  }
);

console.log("[Scheduler] Cron job scheduled. Waiting for next run.");
// Optional: Run once on startup for testing
// runScheduledScrapes().catch(console.error);

// === API ENDPOINTS FOR DASHBOARD & TRACKED PRODUCTS ===

// --- Tracked Products Management ---
// Add a new product to track
app.post("/api/tracked-products", async (req, res) => {
  const { query_term, description } = req.body;
  if (!query_term) {
    return res.status(400).json({ error: "query_term is required" });
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .insert([{ query_term, description, is_active: true }])
    .select();

  if (error) {
    console.error("Error adding tracked product:", error);
    // Handle specific errors like unique constraint violation
    if (error.code === "23505") {
      // unique_violation
      return res
        .status(409)
        .json({ error: "This product query is already being tracked." });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// Get all tracked products
app.get("/api/tracked-products", async (req, res) => {
  const { data, error } = await supabase
    .from("tracked_products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching tracked products:", error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Update a tracked product (e.g., toggle active status, change description)
app.put("/api/tracked-products/:id", async (req, res) => {
  const { id } = req.params;
  const { description, is_active } = req.body;

  const updatePayload = {};
  if (description !== undefined) updatePayload.description = description;
  if (is_active !== undefined) updatePayload.is_active = is_active;

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ error: "No update fields provided." });
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .update(updatePayload)
    .eq("id", id)
    .select();

  if (error) {
    console.error("Error updating tracked product:", error);
    return res.status(500).json({ error: error.message });
  }
  if (!data || data.length === 0) {
    return res.status(404).json({ error: "Tracked product not found." });
  }
  res.json(data[0]);
});

// Delete a tracked product (and its associated listings/prices due to CASCADE)
app.delete("/api/tracked-products/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("tracked_products")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting tracked product:", error);
    return res.status(500).json({ error: error.message });
  }
  // `data` might be null or an empty array on successful delete with no select
  // Supabase delete doesn't return the deleted row by default unless you .select()
  // but count can be used. For simplicity, we check for error.
  // To confirm deletion, you might check if data is null and error is null.
  // Or, if a select() was added, check data.length.
  res.status(204).send(); // No content
});

// --- Dashboard Data Endpoints ---
// Get price history for a specific product listing
app.get("/api/product-listings/:listingId/prices", async (req, res) => {
  const { listingId } = req.params;
  const { data, error } = await supabase
    .from("price_entries")
    .select("price, currency, scraped_at")
    .eq("listing_id", listingId)
    .order("scraped_at", { ascending: true });

  if (error) {
    console.error("Error fetching price history:", error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Get all listings and their latest price for a given tracked_product query_term
app.get("/api/dashboard/data/:queryTerm", async (req, res) => {
  const { queryTerm } = req.params;

  // This query is more complex: fetch listings and their latest price.
  // Using a view or a stored procedure in Supabase would be more efficient.
  // For now, a multi-step approach or a carefully crafted query:

  // Step 1: Get listings for the query term
  const { data: listings, error: listingsError } = await supabase
    .from("product_listings")
    .select("id, store_name, product_name_on_store, url, image_url")
    .eq("tracked_product_query", queryTerm);

  if (listingsError) {
    console.error("Error fetching listings for dashboard:", listingsError);
    return res.status(500).json({ error: listingsError.message });
  }
  if (!listings || listings.length === 0) {
    return res.json([]); // No listings found for this query term
  }

  // Step 2: For each listing, get the latest price
  // This can lead to N+1 query problem. Better to use Supabase functions/views or a complex join.
  // Simplified approach for now (can be slow for many listings):
  const listingsWithPrices = await Promise.all(
    listings.map(async (listing) => {
      const { data: priceEntry, error: priceError } = await supabase
        .from("price_entries")
        .select("price, currency, scraped_at")
        .eq("listing_id", listing.id)
        .order("scraped_at", { ascending: false })
        .limit(1)
        .single(); // Get only the latest one

      return {
        ...listing,
        latest_price: priceEntry ? priceEntry.price : null,
        currency: priceEntry ? priceEntry.currency : null,
        last_price_update: priceEntry ? priceEntry.scraped_at : null,
      };
    })
  );
  res.json(listingsWithPrices);
});

// === SERVER START ===
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // You might want to trigger an initial scrape if your DB is empty
  // but be careful not to run it every time nodemon restarts during dev.
  // if (process.env.NODE_ENV !== 'development') { // Example condition
  //    runScheduledScrapes();
  // }
});
