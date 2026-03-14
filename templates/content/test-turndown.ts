import TurndownService from "turndown";
const turndownService = new TurndownService();
console.log(turndownService.turndown("<em> text </em>"));
console.log(turndownService.turndown("<em>Hey! <code>repo</code> locally</em>"));
