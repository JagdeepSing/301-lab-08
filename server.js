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


// takes search request and convert to location object
function getLocation(req, res) {
  let query = req.query.data;

  // Define the search query
  let sql = `SELECT * FROM locations WHERE search_query=$1;`;
  let values = [query]; // always an array

  // make the query of the database
  client.query(sql, values)
    .then(result => {
      // check if location was found
      if (result.rowCount > 0) {
        res.send(result.rows[0]);
      } else {
        // if not found in sql, get from API
        const mapsURL = `https://maps.googleapis.com/maps/api/geocode/json?key=${process.env.GOOGLE_MAPS_API_KEY}&address=${query}`;

        superagent.get(mapsURL)
          //if successfully obtained API data
          .then(apiData => {
            if (apiData.body.results.length) { 
              throw 'NO LOCATION DATA'; 
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
  let locID = req.query.data.id;

  let sql = `SELECT * FROM weathers WHERE location_id=$1;`;
  let values = [locID];

  client.query(sql, values)
    .then(result => {
      if (result.rowCount > 0) {
        res.send(result.rows);
      } else {
        const weatherURL = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}`;

        superagent.get(weatherURL)
          .then(apiData => {
            if (apiData.body.daily.data.length === 0) {
              throw 'NO WEATHER DATA';
            } else {
              const weatherSummaries = apiData.body.daily.data.map(day => {
                let forecast =  new Forecast(day);
                forecast.id = locID;

                let insertSQL = 'INSERT INTO weathers (forecast, time, location_id) VALUES ($1, $2, $3);';
                let newValues = Object.values(forecast);

                client.query(insertSQL, newValues);

                return forecast;
              });
              res.send(weatherSummaries);
            }
          })
          .catch(error => handleError(error));
      }
    })
    .catch(error => handleError(error));
}

// Meetups function
function getMeetups(req,res) {
  let locID = req.query.data.id;

  let sql = `SELECT * FROM meetups WHERE location_id=$1;`;
  let values = [locID];

  client.query(sql, values)
    .then(result => {
      if (result.rowCount > 0) {
        res.send(result.rows);
      } else {
        const meetup_url = `https://api.meetup.com/find/upcoming_events?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&sign=true&photo-host=public&page=20&key=${process.env.MEETUP_API_KEY}`;

        superagent.get(meetup_url)
          .then (api_data => {
            if (api_data.body.events.length === 0) {
              throw 'NO EVENT DATA';
            } else {
              const events = api_data.body.events.map(event => {
                let event_info = new Event(event);
                event_info.id = locID;
                let insertSql = `INSERT INTO meetups (link, name, creation_date, host, location_id) VALUES ($1, $2, $3, $4, $5);`;
                let values = Object.values(event_info);
                client.query(insertSql, values);
                return event_info;
              });
              res.send(events);
            }
          })
          .catch(error => handleError(error));
      }
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
  this.search_query = query.data;
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
