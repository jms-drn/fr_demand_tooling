async function loadData() {
  const response = await fetch('./data/latest.json');
  const data = await response.json();

  document.getElementById('status').textContent =
    'Data loaded successfully';

  console.log(data);
}

loadData();
