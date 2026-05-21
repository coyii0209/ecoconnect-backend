require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("EcoConnect backend running on port", PORT);
});
console.log("SERVER.JS RUNNING");