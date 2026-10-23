fetch('./data/latest.json')
  .then(response => response.json())
  .then(data => {

    document.getElementById('status').textContent =
      'Data loaded successfully';

    const latestDemand =
      data.short_term[0].values[0].value;

    document.getElementById('latest-demand').textContent =
      `Latest demand: ${latestDemand.toLocaleString()} MW`;

  })
  .catch(error => {
    document.getElementById('status').textContent =
      'Error loading data';

    console.error(error);
  });
