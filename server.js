'use strict';

require('dotenv').config();

const superagent = require('superagent');
const express = require('express');
const pg = require('pg');

const app = express();

const cors = require('cors');
app.use(cors());

const PORT = process.env.PORT;

// create client connection to database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

// location route, returns location object
// Keys: search_query, formatted_query, latitude and longitude
app.get('/location', getLocation);

// weather route, returns an array of forecast objects
// Keys: forecast, time
app.get('/weather', getWeather);

// create a getMeetups function
app.get('/meetups', getMeetups);

// TODO: create a getYelp function
// app.get('/yelp', getYelp);


app.listen(PORT, () => console.log(`Listening on PORT ${PORT}`));

function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

// HELPER FUNCTIONS

// What we need to do to refactor for SQL
// 1. need to check if the database contains the information
//  a. if exists: get location from DB, return to front
//  b. else: get location from the API -> save to SQL -> return to front

// THIS IS OLD CODE
// takes search request and convert to location object
// function getLocation(req, res) {
//   const mapsURL = `https://maps.googleapis.com/maps/api/geocode/json?key=${process.env.GOOGLE_MAPS_API_KEY}&address=${req.query.data}`;
//   return superagent.get(mapsURL)
//     .then(result => {
//       res.send(new Location(result.body.results[0], req.query));
//     })
//     .catch(error => handleError(error));
// }

function getLocation(req, res) {
  let query = req.query.data;

  // Define the search query
  let sql = "SELECT * FROM locations WHERE search_query=$1"; // $1 represents the index of values
  let values = [query]; // always an array

  // make the query of the database
  return client.query(sql, values)
    .then(result => {
      // check if location was found
      if (result.rowCount > 0) {
        res.send(result.rows[0]);
      } else {
        // if not found in sql, get from API
        const mapsURL = `https://maps.googleapis.com/maps/api/geocode/json?key=${process.env.GOOGLE_MAPS_API_KEY}&address=${query}`;

        return superagent.get(mapsURL)
          //if successfully obtained API data
          .then(apiData => {
            if (!apiData.body.results.length) { 
              throw 'NO DATA'; 
            } else {
              let location = new Location(apiData.body.results[0], req.query);
              
              //inserting new data into the database
              let newSql = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES($1, $2, $3, $4) RETURNING id;`;
              let newValues = Object.values(location);
              
              // make query
              client.query(newSql, newValues)
                //if successfully inserted into database
                .then(result => {
                  // attach returned id onto the location object
                  console.log(result.rows[0]);
                  location.id = result.rows[0].id;
                  res.send(location);
                })
                //if not successfully inputted into database, catch error
                .catch(error => handleError(error));
            }
          })
          //if not successfully obtained API data, catch error
          .catch(error => handleError(error));
      }
    })
    //anything related to getting data out of the database
    .catch(error => handleError(error));

}

// returns array of daily forecasts
function getWeather(req, res) {
  const dark_sky_url = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}`;
  
  return superagent.get(dark_sky_url)
    .then( weatherResult => {
      const weatherSummaries = weatherResult.body.daily.data.map((day) => {
        return new Forecast(day);
      });
      res.send(weatherSummaries);
    })
    .catch(error => handleError(error));
}

// Meetups function
function getMeetups(req,res) {
  const meetup_url = `https://api.meetup.com/find/upcoming_events?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&sign=true&photo-host=public&page=20&key=${process.env.MEETUP_API_KEY}`;

  return superagent.get(meetup_url)
    .then(result => {
      const eventsList = result.body.events.map(event => {
        return new Event(event);
      });
      res.send(eventsList);
    })
    .catch(error => handleError(error));
}

// Event object constructor
function Event(data){
  this.link = data.link;
  this.name = data.name;
  this.creation_date = formatTime(data.created);
  this.host = data.group.name;
}

// Location object constructor
function Location(data, query) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

// Forecast object constructor
function Forecast(day) {
  this.forecast = day.summary;
  this.time = formatTime(day.time*1000);
}

// converts millisecond time to 'Day Month Date Year' format
function formatTime(msTime) {
  return new Date(msTime).toString().slice(0,15);
}
