import { getAllDeals, getDealPipelines } from "../server/lib/hubspot";

async function main() {
  console.log("Fetching all deals from HubSpot...");
  const deals = await getAllDeals();
  
  console.log("Fetching pipelines...");
  const pipelines = await getDealPipelines();
  
  // Filter for deals closed in August 2025
  const augustDeals = deals.filter(deal => {
    const closeDate = deal.properties.closedate;
    if (!closeDate) return false;
    
    const date = new Date(closeDate);
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed, so August = 7
    
    return year === 2025 && month === 7;
  });
  
  // Filter for closed won deals
  const closedWonDeals = augustDeals.filter(deal => {
    const dealstage = deal.properties.dealstage;
    const pipeline = pipelines.find(p => 
      p.stages.some(s => s.id === dealstage)
    );
    
    if (!pipeline) return false;
    
    const stage = pipeline.stages.find(s => s.id === dealstage);
    return stage?.metadata?.probability === "1.0" || 
           stage?.label?.toLowerCase().includes("closed won");
  });
  
  // Sort by amount (descending)
  const sortedDeals = closedWonDeals
    .map(deal => ({
      dealname: deal.properties.dealname || "Unnamed Deal",
      amount: parseFloat(deal.properties.amount || "0"),
      closedate: deal.properties.closedate,
      dealstage: deal.properties.dealstage,
      stageLabel: deal.properties.stageLabel || "Unknown",
      pipeline: deal.properties.pipeline,
      dealId: deal.id,
    }))
    .sort((a, b) => b.amount - a.amount);
  
  console.log("\n=== Large Deals Closed in August 2025 ===\n");
  console.log(`Total closed won deals in August 2025: ${sortedDeals.length}`);
  console.log(`Total value: $${sortedDeals.reduce((sum, d) => sum + d.amount, 0).toLocaleString()}\n`);
  
  // Show top deals
  console.log("Top deals by amount:\n");
  sortedDeals.slice(0, 20).forEach((deal, idx) => {
    console.log(`${idx + 1}. ${deal.dealname}`);
    console.log(`   Amount: $${deal.amount.toLocaleString()}`);
    console.log(`   Close Date: ${new Date(deal.closedate).toLocaleDateString()}`);
    console.log(`   Stage: ${deal.stageLabel}`);
    console.log(`   Deal ID: ${deal.dealId}\n`);
  });
  
  // Export as JSON
  console.log("\nFull data:");
  console.log(JSON.stringify(sortedDeals, null, 2));
}

main().catch(console.error);
