// backend/scrapers/cyberpuertaScraper.js
const playwright = require("playwright");

const STORE_NAME = "Cyberpuerta";
const BASE_SEARCH_URL = "https://www.cyberpuerta.mx";

async function searchCyberpuerta(productName) {
  console.log(`[${STORE_NAME}] Searching for "${productName}"...`);
  let browser = null;
  const products = [];

  try {
    browser = await playwright.chromium.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"], // Add security flags for production
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      // Cyberpuerta might have cookie banners or regional popups. Be prepared to handle them.
      // Example:
      // javaScriptEnabled: true, // Ensure JS is enabled
      // viewport: { width: 1280, height: 800 } // Sometimes helps with layout
    });
    const page = await context.newPage();

    // Handle potential cookie consent pop-up (example, selector needs verification)
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {})); // Auto-dismiss simple dialogs
    try {
      const acceptButton = page
        .locator(
          'button:has-text("Aceptar") >> visible=true, button:has-text("Entendido") >> visible=true, div[id*="cookie"] button:has-text("Aceptar") >> visible=true'
        )
        .first();
      try {
        await acceptButton.waitFor({ state: "visible", timeout: 5000 });
        console.log(`[${STORE_NAME}] Clicking cookie accept button.`);
        await acceptButton.click({ timeout: 3000 });
      } catch (timeoutError) {
        // Cookie button not found within timeout - this is expected behavior
      }
    } catch (e) {
      console.log(
        `[${STORE_NAME}] No cookie banner found or could not click it: ${e.message}`
      );
    }

    const searchUrl = `${BASE_SEARCH_URL}`;
    console.log(`[${STORE_NAME}] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // --- SELECTOR STRATEGY FOR CYBERPUERTA (NEEDS VERIFICATION/ADJUSTMENT) ---
    // These are educated guesses and will likely need to be adjusted after testing.
    // Use DevTools (Inspect Element) on the actual Cyberpuerta search results page.

    const inputSelector = "input[name='searchparam']"; // Search input field// Search button
    const searchInput = page.locator(inputSelector);
    await searchInput.fill(productName);
    await searchInput.press("Enter");
    await page.waitForTimeout(2000); // Wait for the search results to load

    // Wait for the product list container to be visible
    // Common list containers: ul#productList, div.cat produktówlist, div.list μέσω
    /* const productListSelector = ".lineView grid-x"; // This is a guess from previous knowledge, needs verification
    await page.waitForSelector(productListSelector);
    console.log(
      `[${STORE_NAME}] Product list container found: ${productListSelector}`
    ); */

    // Product item selector (e.g., each <li> or <div> that represents a product)
    // Common item selectors: li.product, div.emproduct, article.product-item
    console.log(`[${STORE_NAME}] Waiting for product items to load...`);
    const productItemSelector = '//*[@id="productList"]/li'; // Needs verification
    const productItems = await page
      .locator(`xpath=${productItemSelector}`)
      .all();

    console.log(
      `[${STORE_NAME}] Found ${productItems.length} potential items on the page.`
    );

    const limit = Math.min(productItems.length, 5); // Process up to 5 items

    for (let i = 0; i < limit; i++) {
      const item = productItems[i];
      try {
        // Product Name
        // Common title selectors: a.emproduct_right_title_link, div.name a, h2.product-title
        const titleElement = item.locator(".emproduct_right_title"); // Needs verification
        let title = await titleElement.innerText();
        if (!title) title = await titleElement.getAttribute("title"); // Fallback if innerText is empty
        title = title ? title.trim() : "N/A";
        console.log(title);
        // Product Price
        // Common price selectors: span.price, div.emproduct_right_price_current, span.value
        const priceElement = item.locator(".price"); // Needs verification
        let priceText = await priceElement.innerText();
        // Prices might have currency symbols, thousands separators, etc.
        priceText = priceText.replace("$", "").replace(/,/g, "").trim();
        const price = parseFloat(priceText);
        console.log(price); // Clean up price string

        // Product URL
        // Usually the href of the title link or a dedicated link element
        const urlElement = item.locator(".emproduct_right_title"); // Needs verification
        let relativeUrl = await urlElement.getAttribute("href");
        let url = relativeUrl;
        // Ensure URL is absolute
        if (relativeUrl && !relativeUrl.startsWith("http")) {
          url = new URL(relativeUrl, "https://www.cyberpuerta.mx/").href;
        }
        console.log(url); // Cyberpuerta URLs are usually absolute here

        // Product Image URL
        // Common image selectors: img.img-responsive, div.image img, img.product-image
        const imageElement = item.locator(".cs-image"); // Needs verification
        let imageUrl = await imageElement.getAttribute("style");
        if (imageUrl) {
          // Extract URL from style attribute
          const match = imageUrl.match(/url\(['"]?([^'"]+)['"]?\)/);
          if (match && match[1]) {
            imageUrl = match[1];
          } else {
            imageUrl = null; // Reset if no match found
          }
        }
        if (!imageUrl && (await imageElement.count()) > 0) {
          // Fallback if data-src is not present sometimes
          imageUrl = await imageElement.getAttribute("src");
        }
        if (imageUrl && !imageUrl.startsWith("http")) {
          imageUrl = new URL(imageUrl, "https://www.cyberpuerta.mx/").href;
        }
        console.log(imageUrl); // Handle cases where image might not be found

        // Validate product data quality before adding to results
        if (
          title &&
          title !== "N/A" &&
          title.length > 2 &&
          price !== null &&
          !isNaN(price) &&
          price > 0 &&
          url &&
          url.startsWith("http")
        ) {
          products.push({
            productName: title,
            price: price,
            currency: "MXN", // Cyberpuerta is MXN
            storeName: STORE_NAME,
            url: url,
            imageUrl: imageUrl || "N/A",
          });
        } else {
          console.log(
            `[${STORE_NAME}] Skipping invalid product data: title="${title}", price=${price}, url="${url}"`
          );
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
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${STORE_NAME}] Browser closed.`);
    }
  }
  console.log(
    `[${STORE_NAME}] Found ${products.length} products for "${productName}".`
  );
  return products;
}

module.exports = {
  searchCyberpuerta,
};
