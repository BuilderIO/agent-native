import TurndownService from "turndown";
const turndownService = new TurndownService({ emDelimiter: "*" });
console.log("1:", turndownService.turndown("foo <em> text </em> bar"));
console.log(
  "2:",
  turndownService.turndown("<em>Hey! <code>repo</code> locally</em>"),
);
