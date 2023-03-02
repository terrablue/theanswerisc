import penthouse from "penthouse";
import fs from "fs";

penthouse({
  url: "http://localhost:8080/",
  css: "static/css/pico.classless.min.css",
  width: 1920,
  height: 1080,
  keepLargerMediaQueries: true,
  propertiesToRemove: [],
  forceInclude: [/:where/, /::selection/],
}).then((criticalCss) => {
  fs.writeFileSync("static/css/pico.classless.purged.min.css", criticalCss);
});
