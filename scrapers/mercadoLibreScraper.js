// backend/scrapers/mercadoLibreScraper.js
const playwright = require("playwright");

const STORE_NAME = "Mercado Libre";
const BASE_URL = "https://listado.mercadolibre.com.mx/";

async function searchMercadoLibre(productName) {
  console.log(`[${STORE_NAME}] Searching for "${productName}"...`);
  let browser = null;
  const products = [];

  try {
    // Launch the browser (Chromium by default)
    // For production, consider playwright.chromium, .firefox, or .webkit explicitly
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
      timeout: 30000,
    });
    const context = await browser.newContext({
      // Emulate a common user agent to reduce likelihood of being blocked
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36",
      // You might need to handle cookie consent popups if they appear
    });
    const page = await context.newPage();

    // Construct the search URL
    // Mercado Libre uses a path-like structure for search terms, replacing spaces with hyphens
    const searchUrl = `${BASE_URL}${productName.replace(
      /\s+/g,
      "-"
    )}#D[A:${productName.replace(/\s+/g, "+")}]`;
    console.log(`[${STORE_NAME}] Navigating to: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for the main results container to be visible
    await page.waitForSelector(".ui-search-results", { timeout: 30000 });

    // Get all product items. We'll limit to a few to keep it simple.
    const productItems = await page.locator(".ui-search-result__wrapper").all();

    console.log(
      `[${STORE_NAME}] Found ${productItems.length} potential items on the page.`
    );

    // Limit the number of products to process to avoid overly long scraping times for a demo
    const limit = Math.min(productItems.length, 5); // Process up to 5 items

    for (let i = 0; i < limit; i++) {
      const item = productItems[i];
      try {
        // Product Name
        const nameElement = item.locator(".poly-component__title");
        const title = await nameElement.innerText();
        console.log(title);
        // Product Price
        // Price is often in a structure like: <span class="andes-money-amount__fraction">PRICE</span>
        const priceElement = item
          .locator(".andes-money-amount__fraction")
          .first(); // Take the first if multiple (e.g. original price crossed out)
        const priceText = await priceElement.innerText();
        const price = parseFloat(priceText.replace(/[^\d.-]/g, ""));
        console.log(price); // Clean up price string

        // Product URL
        const urlElement = item.locator("a.poly-component__title"); // The link is usually on an <a> tag
        const relativeUrl = await urlElement.getAttribute("href");
        const url = relativeUrl;
        console.log(url); // Mercado Libre URLs are usually absolute here

        // Product Image URL
        // Images are often lazy-loaded, so ensure the selector is correct and image is visible
        const imageElement = item.locator(".poly-component__picture");
        let imageUrl =
          (await imageElement.getAttribute("data-src")) ||
          (await imageElement.getAttribute("src"));
        if (!imageUrl && (await imageElement.count()) > 0) {
          // Fallback if data-src is not present sometimes
          imageUrl = await imageElement.getAttribute("src");
        }

        if (title && !isNaN(price) && url) {
          products.push({
            productName: title.trim(),
            price: price,
            currency: "MXN", // Assuming MXN for mercadolibre.com.mx
            storeName: STORE_NAME,
            url: url,
            imageUrl: imageUrl || "N/A", // Handle cases where image might not be found
          });
        }
      } catch (e) {
        console.warn(
          `[${STORE_NAME}] Error processing an item: ${e.message}. Item might be an ad or different structure.`
        );
      }
    }
  } catch (error) {
    console.error(
      `[${STORE_NAME}] Error during scraping for "${productName}":`,
      error
    );
    // Return an empty array or throw the error, depending on desired error handling
    // For now, we'll return what we've gathered, or an empty array if a major error occurred.
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${STORE_NAME}] Browser closed.`);
    }
  }
  console.log(
    `[${STORE_NAME}] Found ${products.length} products for "${productName}".`
  );
  return products; // Always return an array
}

module.exports = {
  searchMercadoLibre,
};
