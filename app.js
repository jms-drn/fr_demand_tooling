console.log("APP JS LOADED");

fetch('./data/latest.json')
  .then(response => {
    console.log("STATUS:", response.status);
    console.log("URL:", response.url);
    return response.json();
  })
  .then(data => {
    console.log("DATA LOADED");
    console.log(data);
  })
  .catch(error => {
    console.error("FETCH ERROR");
    console.error(error);
  });
