fetch('./data/latest.json')
  .then(response => response.json())
  .then(data => {

    const realised = data.short_term.find(
      item => item.type === "REALISED"
    );

    const idForecast = data.short_term.find(
      item => item.type === "ID"
    );

    const latestActual =
      realised.values[realised.values.length - 1];

    const latestForecast =
      idForecast.values[idForecast.values.length - 1];

    document.getElementById("actual-demand").textContent =
      `Actual demand: ${latestActual.value.toLocaleString()} MW`;

    document.getElementById("id-forecast").textContent =
      `ID forecast: ${latestForecast.value.toLocaleString()} MW`;

    document.getElementById("last-update").textContent =
      `Updated: ${latestActual.updated_date}`;

    console.log("Actual", latestActual);
    console.log("Forecast", latestForecast);

  })
  .catch(error => {
    console.error(error);
  });
