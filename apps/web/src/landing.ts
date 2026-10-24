import "./landing.css";
import "./showcase.css";
const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
