(function () {
  const notice = document.querySelector("#access-notice");
  const button = document.querySelector("#google-signin");
  function explain(message) {
    notice.textContent = message;
    notice.hidden = false;
  }
  if (!["http:", "https:"].includes(window.location.protocol)) {
    button.addEventListener("click", function () {
      explain("Para iniciar sesión, abre WMS desde su dirección web. El acceso con Google no funciona al abrir el archivo directamente.");
    });
    button.disabled = false;
    return;
  }
  import("./app.js").catch(function () {
    explain("No pudimos cargar el acceso. Revisa tu conexión y vuelve a abrir WMS.");
  });
})();
