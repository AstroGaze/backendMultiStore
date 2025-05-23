// backend/scrapers/mockStoreScraper.js

// Simulates fetching data from a store
async function searchMockStore(productName, storeIdentifier) {
  console.log(
    `[MockScraper-${storeIdentifier}] Searching for "${productName}"...`
  );
  // Simulate network delay
  await new Promise((resolve) =>
    setTimeout(resolve, Math.random() * 1000 + 500)
  );

  // Simulate finding 0 to 2 products
  const numResults = Math.floor(Math.random() * 3);
  const results = [];

  for (let i = 0; i < numResults; i++) {
    results.push({
      productName: `${productName} - Variant ${
        i + 1
      } (from ${storeIdentifier})`,
      price: parseFloat((Math.random() * 200 + 50).toFixed(2)), // Random price
      currency: "MXN",
      storeName: `Mock Store ${storeIdentifier}`,
      url: `http://mock${storeIdentifier}.example.com/product/${encodeURIComponent(
        productName
      )}-${i + 1}`,
      imageUrl: `https://via.placeholder.com/100?text=${storeIdentifier}+${
        i + 1
      }`,
    });
  }
  console.log(
    `[MockScraper-${storeIdentifier}] Found ${results.length} results for "${productName}".`
  );
  return results; // Always return an array, even if empty
}

module.exports = {
  searchMockStoreA: (productName) => searchMockStore(productName, "A"),
  searchMockStoreB: (productName) => searchMockStore(productName, "B"),
};
