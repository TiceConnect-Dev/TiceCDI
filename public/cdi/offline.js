// Page de reconnexion de la borne (servie par le service worker hors connexion).
let seconds = 10;
const status = document.getElementById("offline-status");
const retry = () => location.reload();
setInterval(() => {
  seconds -= 1;
  if (seconds <= 0) retry();
  else if (status) status.textContent = `Nouvelle tentative dans ${seconds} s…`;
}, 1000);
addEventListener("online", retry);
