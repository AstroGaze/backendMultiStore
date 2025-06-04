// backend/scrapers/mercadoLibreScraper.js
const playwright = require("playwright");

const STORE_NAME = "Mercado Libre";
// BASE_URL is not strictly needed if all extracted hrefs are absolute,
// but good to have if we ever needed to construct a search URL manually from productName.
// For now, direct navigation to the search results page is used.
const SEARCH_PAGE_BASE_URL = "https://listado.mercadolibre.com.mx/";

async function searchMercadoLibre(productName) {
  console.log(`[${STORE_NAME}] Searching for "${productName}"...`);
  let browser = null;
  const products = [];

  try {
    browser = await playwright.chromium.launch({
      headless: true, // Set to true for automated runs, false for debugging
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Good for CI/Docker environments
      ],
      // timeout on launch is for browser process starting, not individual operations.
      // Individual operations like goto, waitForSelector have their own timeouts.
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36", // Updated UA
      // Consider handling cookie consent popups if they interfere
      // Example:
      // page.on('load', async () => {
      //   try {
      //     await page.locator('button:has-text("Entendido")').click({ timeout: 3000 });
      //   } catch (e) { /* ignore if not found */ }
      // });
    });
    const page = await context.newPage();

    const searchUrl = `${SEARCH_PAGE_BASE_URL}${productName.replace(
      /\s+/g,
      "-" // ML uses hyphens for spaces in search path
    )}#D[A:${productName.replace(/\s+/g, "+")}]`; // ML specific search URL structure

    console.log(`[${STORE_NAME}] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded", // Or 'networkidle' if content loads very late
      timeout: 60000, // Increased timeout for page navigation
    });

    // Wait for the main results container. Use a selector that is consistently present.
    const resultsContainerSelector = ".ui-search-results";
    try {
      await page.waitForSelector(resultsContainerSelector, { timeout: 45000 });
    } catch (e) {
      console.error(
        `[${STORE_NAME}] Results container '${resultsContainerSelector}' not found for "${productName}". Page might have changed or no results. Error: ${e.message}`
      );
      await browser.close();
      return []; // Return empty if no results container
    }

    // Get all product items. This selector seems to work for general product cards.
    const productItemSelector = ".ui-search-result__wrapper";
    const productItems = await page.locator(productItemSelector).all();

    console.log(
      `[${STORE_NAME}] Found ${productItems.length} potential items on the page for "${productName}".`
    );

    const limit = Math.min(productItems.length, 5); // Process up to 5 items for demo

    for (let i = 0; i < limit; i++) {
      const item = productItems[i];
      let title = "N/A"; // Default title

      try {
        // Product Name
        // .poly-component__title was used, but let's try a more common one: .ui-search-item__title
        const nameElement = item.locator(".ui-search-item__title").first(); // Prefer more specific item title
        if ((await nameElement.count()) > 0) {
          title = await nameElement.innerText();
        } else {
          // Fallback to the poly-component title if the other isn't found
          const polyNameElement = item
            .locator(".poly-component__title")
            .first();
          if ((await polyNameElement.count()) > 0) {
            title = await polyNameElement.innerText();
          } else {
            console.warn(`[${STORE_NAME}] Could not find title for an item.`);
            continue; // Skip if no title
          }
        }
        title = title.trim();

        // Product Price
        const priceElement = item
          .locator(".andes-money-amount__fraction")
          .first();
        let priceText = "0";
        if ((await priceElement.count()) > 0) {
          priceText = await priceElement.innerText();
        } else {
          console.warn(
            `[${STORE_NAME}] Price element not found for item: ${title}`
          );
          // Decide: skip item, or use a default price like 0 or null?
          // For price comparison, a missing price is problematic. Let's skip.
          continue;
        }
        const price = parseFloat(priceText.replace(/[^\d.-]/g, ""));

        // Product Image URL using XPath
        const imageXPath = "(//div[@class='poly-card__portada']//img)[1]";
        const imageElement = item.locator(`xpath=${imageXPath}`);
        let imageUrl = null;
        if ((await imageElement.count()) > 0) {
          imageUrl = await imageElement.getAttribute("src");
        }
        
        // Fallback to original selectors if XPath doesn't find anything
        if (!imageUrl) {
          const fallbackImageElement = item
            .locator(".ui-search-result-image__element")
            .first();
          if ((await fallbackImageElement.count()) > 0) {
            imageUrl =
              (await fallbackImageElement.getAttribute("data-src")) ||
              (await fallbackImageElement.getAttribute("src"));
          }
        }

        // --- REVISED AND CENTRALIZED URL EXTRACTION & NORMALIZATION ---
        let normalizedProductUrl = null;
        // The main link for the product item is often on 'a.ui-search-link'
        const linkElement = item.locator(".poly-component__title").first();

        if ((await linkElement.count()) > 0) {
          let rawHref = await linkElement.getAttribute("href");

          if (rawHref) {
            // console.log(`[${STORE_NAME}] Original URL for "${title}": ${rawHref}`);
            try {
              const parsedUrl = new URL(rawHref); // new URL() can handle absolute and relative URLs if a base is provided, but ML links are usually absolute.
              // Construct the canonical URL: protocol + hostname + pathname
              normalizedProductUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}`;
              // console.log(`[${STORE_NAME}] Normalized URL for "${title}": ${normalizedProductUrl}`);
            } catch (e) {
              console.warn(
                `[${STORE_NAME}] Could not parse URL: ${rawHref} for item "${title}". Error: ${e.message}. Using raw href as fallback.`
              );
              normalizedProductUrl = rawHref; // Fallback
            }
          }
        }

        if (!normalizedProductUrl) {
          console.warn(
            `[${STORE_NAME}] Could not extract product URL for item: ${title}. Skipping.`
          );
          continue; // Skip if URL is not found/extracted
        }
        // --- END OF URL EXTRACTION & NORMALIZATION ---

        // Basic validation before pushing
        if (title && title !== "N/A" && !isNaN(price) && normalizedProductUrl) {
          products.push({
            productName: title,
            price: price,
            currency: "MXN", // Assuming MXN for mercadolibre.com.mx
            storeName: STORE_NAME,
            url: normalizedProductUrl, // Use the normalized URL
            imageUrl: imageUrl || "N/A",
          });
        } else {
          console.warn(
            `[${STORE_NAME}] Skipping item due to missing critical data: Title='${title}', Price=${price}, URL='${normalizedProductUrl}'`
          );
        }
      } catch (e) {
        console.warn(
          `[${STORE_NAME}] Error processing an item (Title: ${title}): ${e.message}. Item might be an ad or have a different structure.`
        );
      }
    }
  } catch (error) {
    console.error(
      `[${STORE_NAME}] Major error during scraping for "${productName}":`,
      error
    );
    // Return an empty array or throw, depending on desired handling.
    // For scheduled tasks, usually better to return empty and log, than to crash the whole scheduler.
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${STORE_NAME}] Browser closed for "${productName}".`);
    }
  }
  console.log(
    `[${STORE_NAME}] Found and processed ${products.length} products for "${productName}".`
  );
  return products; // Always return an array
}

module.exports = {
  searchMercadoLibre,
};
