
const PORT=3000;

var natUpnp = require('nat-upnp');

var path = require('path');
var fs = require('fs');

var accessoryStorage = require('node-persist').create();

var User = require('./user').User;

var log = require("./logger")._system;
var Logger = require('./logger').Logger;

var FHEM = require('./fhem').FHEM;

module.exports = {
  Server: Server
}

function Server() {
  this._config = this._loadConfig();
}

Server.prototype._loadConfig = function() {

  // Look for the configuration file
  var configPath = User.configPath();
  log.info("using " + configPath );

  // Complain and exit if it doesn't exist yet
  if (!fs.existsSync(configPath)) {
    var config = {};

    config.alexa = {
      "name": "Alexa",
    };

    //return config;
      log.error("Couldn't find a config.json file at '"+configPath+"'. Look at config-sample.json for an example.");
      process.exit(1);
  }

  // Load up the configuration file
  var config;
  try {
    config = JSON.parse(fs.readFileSync(configPath));
  }
  catch (err) {
    log.error("There was a problem reading your config.json file.");
    log.error("Please try pasting your config.json file here to validate it: http://jsonlint.com");
    log.error("");
    throw err;
  }

  var accessoryCount = (config.accessories && config.accessories.length) || 0;

  var username = config.alexa.username;

  log.info("---");

  return config;
}

var upnp_client;
Server.prototype.run = function() {
  if( !this._config.connections ) {
    log.error( 'no connections in config file' );
    process.exit( -1 );
  }

  log.info('Trying UPnP NAT-PMP ...');
  upnp_client = natUpnp.createClient();

  //upnp_client.externalIp(function(err, ip) {
    //console.log(err);
    //console.log(ip);
  //});

  var server = this;
  upnp_client.portMapping({
    public: PORT,
    private: PORT,
    ttl: 10
  }, function(err) {
    if( err )
      console.log('NAT-PMP failed: '+ err)

    function handleRequest(request, response){
      //console.log( request );

      var rawData = '';
      request.on('data', function(chunk){rawData += chunk});
      request.on('end', function() {
        try {
          var event = JSON.parse(rawData);
          //console.log(event);
          verifyToken.bind(server)(event, function(ret) {
            console.log('response :' + JSON.stringify(ret));
            response.end(JSON.stringify(ret)); });

        } catch (error) {
          log2("Error", error);
          response.end(JSON.stringify(createError(ERROR_UNSUPPORTED_OPERATION)));

        }// try-catch
      });
    }

    //Lets require/import the HTTP module
    var http = require('https');

    //Create a server
    var options = {
        key: fs.readFileSync(this._config.alexa.keyFile || './key.pem'),
        cert: fs.readFileSync( this._config.alexa.certFile || './cert.pem'),
    };
    this.server = http.createServer(options,handleRequest);

    //Lets start our server
    this.server.listen(PORT, function(){
        //Callback triggered when server is successfully listening. Hurray!
        console.log("Server listening on: https://%s:%s", this.server.address().address, this.server.address().port);
    }.bind(this) );
  }.bind(this));


  log.info('Fetching FHEM devices...');

  this.devices = {};
  this.connections = [];
  for( connection of this._config.connections ) {
    var fhem = new FHEM(Logger.withPrefix(connection.name), connection);
    fhem.connect( function(devices){
      for( device of devices ) {
        device.fhem = fhem;

        this.devices[device.device] = device;

        for( var characteristic_type in device.mappings ) {
          if( characteristic_type == 'On'
              || characteristic_type == 'Brightness' || characteristic_type == 'TargetPosition'
              || characteristic_type == 'Volume'
              || characteristic_type == 'TargetTemperature' ) {
            device.subscribe( device.mappings[characteristic_type] );
          }
        }
      }
    }.bind(this) );

    this.connections.push( fhem );
  }
}

Server.prototype.shutdown = function() {
  if( !upnp_client )
    return;

  log.info('Stopping UPnP NAT-PMP ...');
  upnp_client.portUnmapping({
    public: PORT
  });
}






// namespaces

const NAMESPACE_CONTROL = "Alexa.ConnectedHome.Control";

const NAMESPACE_DISCOVERY = "Alexa.ConnectedHome.Discovery";

// discovery

const REQUEST_DISCOVER = "DiscoverAppliancesRequest";

const RESPONSE_DISCOVER = "DiscoverAppliancesResponse";

// control

const REQUEST_TURN_ON = "TurnOnRequest";
const RESPONSE_TURN_ON = "TurnOnConfirmation";

const REQUEST_TURN_OFF = "TurnOffRequest";
const RESPONSE_TURN_OFF = "TurnOffConfirmation";

const REQUEST_SET_PERCENTAGE = "SetPercentageRequest";
const RESPONSE_SET_PERCENTAGE = "SetPercentageConfirmation";

const REQUEST_INCREMENT_PERCENTAGE = "IncrementPercentageRequest";
const RESPONSE_INCREMENT_PERCENTAGE = "IncrementPercentageConfirmation";

const REQUEST_DECREMENT_PERCENTAGE = "DecrementPercentageRequest";
const RESPONSE_DECREMENT_PERCENTAGE = "DecrementPercentageConfirmation";


const REQUEST_SET_TARGET_TEMPERATURE = "SetTargetTemperatureRequest";
const RESPONSE_SET_TARGET_TEMPERATURE = "SetTargetTemperatureConfirmation";

const REQUEST_INCREMENT_TARGET_TEMPERATURE = "IncrementTargetTemperatureRequest";
const RESPONSE_INCREMENT_TARGET_TEMPERATURE = "IncrementTargetTemperatureConfirmation";

const REQUEST_DECREMENT_TARGET_TEMPERATURE = "DecrementTargetTemperatureRequest";
const RESPONSE_DECREMENT_TARGET_TEMPERATURE = "DecrementTargetTemperatureConfirmation";

// errors

const ERROR_NO_SUCH_TARGET = "NoSuchTargetError";

const ERROR_VALUE_OUT_OF_RANGE = "ValueOutOfRangeError";

const ERROR_UNSUPPORTED_OPERATION = "UnsupportedOperationError";

const ERROR_UNSUPPORTED_TARGET = "UnsupportedTargetError";

const ERROR_UNEXPECTED_INFO = "UnexpectedInformationReceivedError";

const ERROR_INVALID_ACCESS_TOKEN = "InvalidAccessTokenError";


var token;
var expires = 0;
var verifyToken = function(event, callback) {
  if( event.payload.accessToken === token && Date.now() < expires ) {
    handler.bind(this)( event, callback );

  } else {
    token = event.payload.accessToken.replace('|', '%7C');
    var url = "https://api.amazon.com/auth/O2/tokeninfo?access_token="+token;
    //var http = require('https');
    require('https').get( url, function(res) {
      const statusCode = res.statusCode;
      const contentType = res.headers['content-type'];

      var error;
      if (statusCode !== 200 && statusCode !== 400) {
        error = new Error(`Request Failed.\n` +
                          `Status Code: ${statusCode}`);
      } else if (!/^application\/json/.test(contentType)) {
        error = new Error(`Invalid content-type.\n` +
                          `Expected application/json but received ${contentType}`);
      }
      if (error) {
        console.log(error.message);
        // consume response data to free up memory
        res.resume();
        callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
      }

      res.setEncoding('utf8');
      var rawData = '';
      res.on('data', function(chunk){rawData += chunk});
      res.on('end', function() {
        try {
          var parsedData = JSON.parse(rawData);
          if( parsedData.error ) {
            log.error( 'client not authorized: '+ rawData );
            callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
          } else if( !this._config.alexa.oauthClientID || this._config.alexa.oauthClientID === parsedData.aud ) {
            log.info(`accepted new token for: ${parsedData.aud}`);
            log.debug(parsedData);
            token = event.payload.accessToken;
            expires = Date.now() + event.payload.exp;
            handler.bind(this)( event, callback );
          } else {
            log.error(`clientId ${parsedData.aud} not authorized`);
            log.debug(parsedData);
            callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
          }
        } catch (e) {
          console.log(e.message);
          callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
        }
      }.bind(this));
    }.bind(this)).on('error', function(e){
      console.log(`Got error: ${e.message}`);
      callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
    });

  }
}

// entry
var handler = function(event, callback) {
  log2("Received Directive", event);

  var requestedNamespace = event.header.namespace;

  var response = null;

  try {

    switch (requestedNamespace) {

      case NAMESPACE_DISCOVERY:

        response = handleDiscovery.bind(this)(event);

        break;

      case NAMESPACE_CONTROL:

        response = handleControl.bind(this)(event);

        break;

      default:

        log2("Error", "Unsupported namespace: " + requestedNamespace);

        response = handleUnexpectedInfo(requestedNamespace);

        break;

    }// switch

  } catch (error) {

    log2("Error", error);

  }// try-catch

  callback( response );
  //return response;

}// exports.handler


var handleDiscovery = function(event) {

  var header = createHeader(NAMESPACE_DISCOVERY, RESPONSE_DISCOVER);

  var payload = {

    "discoveredAppliances": []
  };

  for( connection of this.connections ) {
    for( device of connection.devices ) {

      if( device.mappings.On || device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume || device.mappings.TargetTemperature ) {
        //console.log(device);
        var d = { "applianceId": device.uuid_base.replace( /[^\w_\-=#;:?@&]/g, '_' ),
                  "manufacturerName":"FHEM"+device.type,
                  "modelName":"FHEM"+ (device.model ? device.model : '<unknown>'),
                  "version":"your software version number here.",
                  "friendlyName":device.alias,
                  "friendlyDescription": 'name: ' + device.name + ', alias: ' + device.alias,
                  "isReachable":true,
                  "actions":[],
                  "additionalApplianceDetails": { "device": device.device },
                };

        if( device.mappings.On ) {
          d.actions.push( "turnOn" );
          d.actions.push( "turnOff" );
        }

        if( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume ) {
          d.actions.push( "setPercentage" );
          d.actions.push( "incrementPercentage" );
          d.actions.push( "decrementPercentage" );
        }

        if( device.mappings.TargetTemperature  ) {
          d.actions.push( "setTargetTemperature" );
          d.actions.push( "incrementTargetTemperature" );
          d.actions.push( "decrementTargetTemperature" );
        }

        payload.discoveredAppliances.push( d );
      }
    }
  }

  return createDirective(header,payload);

}// handleDiscovery


var handleControl = function(event) {

  var response = null;

  var requestedName = event.header.name;

  switch (requestedName) {

    case REQUEST_TURN_ON :
      response = handleControlTurnOn.bind(this)(event);
      break;

    case REQUEST_TURN_OFF :
      response = handleControlTurnOff.bind(this)(event);
      break;

    case REQUEST_SET_PERCENTAGE :
      response = handleControlSetPercentage.bind(this)(event);
      break;

    case REQUEST_INCREMENT_PERCENTAGE :
      response = handleControlIncrementPercentage.bind(this)(event);
      break;

    case REQUEST_DECREMENT_PERCENTAGE :
      response = handleControlDecrementPercentage.bind(this)(event);
      break;

    case REQUEST_SET_TARGET_TEMPERATURE :
      response = handleControlSetTargetTemperature.bind(this)(event);
      break;

    case REQUEST_INCREMENT_TARGET_TEMPERATURE :
      response = handleControlIncrementTargetTemperature.bind(this)(event);
      break;

    case REQUEST_DECREMENT_TARGET_TEMPERATURE :
      response = handleControlDecrementTargetTemperature.bind(this)(event);
      break;

    default:
      log2("Error", "Unsupported operation" + requestedName);
      response = handleUnsupportedOperation();

      break;

  }// switch

  return response;

}// handleControl


var handleControlTurnOn = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return createError(ERROR_UNSUPPORTED_TARGET);

  device.command( device.mappings.On, 1 );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_TURN_ON);

  var payload = {};

  return createDirective(header,payload);

}// handleControlTurnOn


var handleControlTurnOff = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  device.command( device.mappings.On, 0 );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_TURN_OFF);

  var payload = {};

  return createDirective(header,payload);

}// handleControlTurnOff


var handleControlSetPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  device.command( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume, event.payload.percentageState.value );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_SET_PERCENTAGE);

  var payload = {};

  return createDirective(header,payload);

}// handleControlSetPercentage


var handleControlIncrementPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  var current;
  if( device.mappings.Brightness ) {
    current = device.fhem.cached(device.mappings.Brightness.informId);
  } else if( device.mappings.TargetPosition ) {
    current = device.fhem.cached(device.mappings.TargetPosition.informId);
  } else if( device.mappings.Volume ) {
    current = device.fhem.cached(device.mappings.Volume.informId);
  }
  current = parseFloat( current );
  target = current + event.payload.deltaPercentage.value;
  if( target < 0 || target > 100 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {"minimumValue":0, "maximumValue":100});
  device.command( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_INCREMENT_PERCENTAGE);

  var payload = {};

  return createDirective(header,payload);

}// handleControlIncrementPercentage


var handleControlDecrementPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  var current;
  if( device.mappings.Brightness ) {
    current = device.fhem.cached(device.mappings.Brightness.informId);
  } else if( device.mappings.TargetPosition ) {
    current = device.fhem.cached(device.mappings.TargetPosition.informId);
  } else if( device.mappings.Volume ) {
    current = device.fhem.cached(device.mappings.Volume.informId);
  }
  current = parseFloat( current );
  target = current - event.payload.deltaPercentage.value;
  if( target < 0 || target > 100 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {"minimumValue":0, "maximumValue":100});
  device.command( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_DECREMENT_PERCENTAGE);

  var payload = {};

  return createDirective(header,payload);

}// handleControlDecrementPercentage


var handleControlSetTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));

  var target = event.payload.targetTemperature.value;
  if( target < 15 || target > 30 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {"minimumValue":15.0, "maximumValue":30.0});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_SET_TARGET_TEMPERATURE);

  var payload = { "targetTemperature": { "value": target },
                  //"temperatureMode":{ "value":"AUTO" },
                  "previousState":{ "targetTemperature":{ "value": current },
                                    //"mode":{ "value":"AUTO" },
                                  }
                };


  return createDirective(header,payload);

}// handleControlSetTargetTemperature


var handleControlIncrementTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = current + event.payload.deltaTemperature.value;
  if( target < 15 || target > 30 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {"minimumValue":15.0, "maximumValue":30.0});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_INCREMENT_TARGET_TEMPERATURE);

  var payload = { "targetTemperature": { "value": target },
                  //"temperatureMode":{ "value":"AUTO" },
                  "previousState":{ "targetTemperature":{ "value": current },
                                    //"mode":{ "value":"AUTO" },
                                  }
                };


  return createDirective(header,payload);

}// handleControlIncrementTemperature


var handleControlDecrementTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = current - event.payload.deltaTemperature.value;
  if( target < 15 || target > 30 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {"minimumValue":15.0, "maximumValue":30.0});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_DECREMENT_TARGET_TEMPERATURE);

  var payload = { "targetTemperature": { "value": target },
                  //"temperatureMode":{ "value":"AUTO" },
                  "previousState":{ "targetTemperature":{ "value": current },
                                    //"mode":{ "value":"AUTO" },
                                  }
                };


  return createDirective(header,payload);

}// handleControlDecrementTemperature


var handleUnsupportedOperation = function() {

  var header = createHeader(NAMESPACE_CONTROL,ERROR_UNSUPPORTED_OPERATION);

  var payload = {};

  return createDirective(header,payload);

}// handleUnsupportedOperation


var handleUnexpectedInfo = function(fault) {

  var header = createHeader(NAMESPACE_CONTROL,ERROR_UNEXPECTED_INFO);

  var payload = {

    "faultingParameter" : fault

  };

  return createDirective(header,payload);

}// handleUnexpectedInfo


// support functions

var createMessageId = function() {

  var d = new Date().getTime();

  var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {

    var r = (d + Math.random()*16)%16 | 0;

    d = Math.floor(d/16);

    return (c=='x' ? r : (r&0x3|0x8)).toString(16);

  });

  return uuid;

}// createMessageId


var createHeader = function(namespace, name) {

  return {

    "messageId": createMessageId(),

    "namespace": namespace,

    "name": name,

    "payloadVersion": "2"

  };

}// createHeader


var createDirective = function(header, payload) {

  return {

    "header" : header,

    "payload" : payload

  };

}// createDirective

var createError = function(error,payload) {

  if( payload === undefined )
    payload = {};

  return {

    "header" : createHeader(NAMESPACE_CONTROL,error),

    "payload" : payload,

  };
}// createError


var log2 = function(title, msg) {

  console.log('**** ' + title + ': ' + JSON.stringify(msg));

}// log
