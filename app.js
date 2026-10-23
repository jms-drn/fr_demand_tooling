fetch('./data/latest.json')
  .then(response => response.json())
  .then(data => {

    const realised =
      data.short_term.find(x => x.type === "REALISED");

    const id =
      data.short_term.find(x => x.type === "ID");

    const d1 =
      data.short_term.find(x => x.type === "D-1");

    const d2 =
      data.short_term.find(x => x.type === "D-2");

    const latestActual =
      realised.values[realised.values.length - 1];

    const latestId =
      id.values[id.values.length - 1];

    const latestD1 =
      d1.values[d1.values.length - 1];

    const latestD2 =
      d2.values[d2.values.length - 1];

    document.getElementById('actual-demand').textContent =
      `${(latestActual.value / 1000).toFixed(1)} GW`;

    document.getElementById('id-forecast').textContent =
      `${(latestId.value / 1000).toFixed(1)} GW`;

    document.getElementById('d1-forecast').textContent =
      `${(latestD1.value / 1000).toFixed(1)} GW`;

    document.getElementById('d2-forecast').textContent =
      `${(latestD2.value / 1000).toFixed(1)} GW`;

    const diff =
      latestId.value - latestActual.value;

    document.getElementById('difference').textContent =
      `${(diff / 1000).toFixed(1)} GW`;

    document.getElementById('time-info').innerHTML = `
      <strong>Demand interval:</strong>
      ${latestActual.start_date}
      to
      ${latestActual.end_date}
      <br><br>

      <strong>Published by RTE:</strong>
      ${latestActual.updated_date}
    `;

  })
  .catch(error => {
    console.error(error);
  });
