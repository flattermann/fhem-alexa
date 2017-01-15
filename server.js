
const PORT=3000;

var natpmp = require('nat-pmp');
var natupnp = require('nat-upnp');

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
      name: 'Alexa',
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

Server.prototype.startServer = function() {
  function handleRequest(request, response){
    //console.log( request );

    var body = '';
    request.on('data', function(chunk){body += chunk});
    request.on('end', function() {
      try {
        var event = JSON.parse(body);
        //console.log(event);
        verifyToken.bind(this)(event, function(ret) {
          console.log('response :' + JSON.stringify(ret));
          response.end(JSON.stringify(ret)); });

      } catch (error) {
        //log2("Error", error);

          response.end(JSON.stringify(createError(ERROR_UNSUPPORTED_OPERATION)));

      }// try-catch
    }.bind(this));
  }

  //Lets require/import the HTTP module
  //Create a server
  var options = {
      key: fs.readFileSync(this._config.alexa.keyFile || './key.pem'),
      cert: fs.readFileSync( this._config.alexa.certFile || './cert.pem'),
  };
  this.server = require('https').createServer(options,handleRequest.bind(this));

  //Lets start our server
  this.server.listen(PORT, function(){
      //Callback triggered when server is successfully listening. Hurray!
      log.info("Server listening on: https://%s:%s", this.server.address().address, this.server.address().port);
  }.bind(this) );
}

var pmp_client;
function open_pmp(ip) {
  if( ip ) {
    log.info('Trying NAT-PMP ...');
    pmp_client = natpmp.connect(ip);
    pmp_client.externalIp(function (err, info) {
      if (err) throw err;
      log.info('Current external IP address: %s', info.ip.join('.'));
    });

    setInterval( open_pmp, 3500*1000 );
  }

  pmp_client.portMapping({ private: PORT, public: PORT, ttl: 3600 }, function (err, info) {
    if (err) throw err;
    log.debug(info);
  });
}

var upnp_client;
function open_upnp() {
  if( !upnp_client ) {
    log.info('Trying NAT-UPNP ...');
    upnp_client = natupnp.createClient();
    upnp_client.externalIp(function(err, ip) {
      if (err) throw err;
      log.info('Current external IP address: %s', ip);
    });

    setInterval( open_upnp, 3500*1000 );
  }

  upnp_client.portMapping({
    public: PORT,
    private: PORT,
    ttl: 3600
  }, function(err) {
    if( err ) {
      log.error('NAT-UPNP failed: '+ err)
    }
  });
}


Server.prototype.run = function() {
  if( !this._config.connections ) {
    log.error( 'no connections in config file' );
    process.exit( -1 );
  }

  if( this._config.alexa['nat-pmp'] )
    open_pmp(this._config.alexa['nat-pmp']);

  if( this._config.alexa['nat-upnp'] )
    open_upnp();

  this.startServer();

  log.info('Fetching FHEM devices...');

  this.devices = {};
  this.namesOfRoom = {};
  this.roomsOfName = {};
  this.connections = [];
  for( connection of this._config.connections ) {
    var fhem = new FHEM(Logger.withPrefix(connection.name), connection);
    //fhem.on( 'DEFINED', function() {log.error( 'DEFINED' )}.bind(this) );

    fhem.connect( function(devices){
      for( device of devices ) {
        device.fhem = fhem;

        this.devices[device.device.toLowerCase()] = device;
        if(device.room) {
          var room = device.room.toLowerCase();
          var name = device.alexaName.toLowerCase();

          if( !this.namesOfRoom[room] ) this.namesOfRoom[room] = [];
          this.namesOfRoom[room].push( name );

          if( !this.roomsOfName[name] ) this.roomsOfName[name] = [];
          this.roomsOfName[name].push( room );
        }

        for( var characteristic_type in device.mappings ) {
          if( characteristic_type == 'On'
              || characteristic_type == 'Brightness' || characteristic_type == 'TargetPosition'
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
  if( pmp_client ) {
    log.info('Stopping NAT-PMP ...');
    pmp_client.portUnmapping({ public: PORT, private: PORT }, function (err, info) {
    if (err) throw err;
    log.debug('Port Unmapping:', info);
    pmp_client.close();
    });
  }

  if( upnp_client ) {
    log.info('Stopping NAT-UPNP ...');
    upnp_client.portUnmapping({
      public: PORT
    });
  }
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


var accepted_token;
var expires = 0;
var verifyToken = function(event, callback) {
  var token;
  if( event.payload )
    token = event.payload.accessToken;
  else if( event.session )
    token = undefined;

  if( token === accepted_token && Date.now() < expires ) {
    handler.bind(this)( event, callback );

  } else if( token ) {
    var url = "https://api.amazon.com/auth/O2/tokeninfo?access_token="+token.replace('|', '%7C');
    require('https').get( url, function(result) {
      const statusCode = result.statusCode;
      const contentType = result.headers['content-type'];

      var error;
      if(statusCode !== 200 && statusCode !== 400) {
        error = new Error(`Request Failed.\n` +
                          `Status Code: ${statusCode}`);
      } else if(!/^application\/json/.test(contentType)) {
        error = new Error(`Invalid content-type.\n` +
                          `Expected application/json but received ${contentType}`);
      }
      if(error) {
        log.error(error.message);
        // consume response data to free up memory
        result.resume();
        callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
        return;
      }

      result.setEncoding('utf8');
      var body = '';
      result.on('data', function(chunk){body += chunk});
      result.on('end', function() {
        try {
          var parsedData = JSON.parse(body);
          if( parsedData.error ) {
            log.error( 'client not authorized: '+ body );

            callback( createError(ERROR_INVALID_ACCESS_TOKEN) );

          } else if( !this._config.alexa.oauthClientID || this._config.alexa.oauthClientID === parsedData.aud ) {
            log.info('accepted new token');
            //log.info(`accepted new token for: ${parsedData.aud}`);
            log.debug(parsedData);
            accepted_token = token;
            expires = Date.now() + parsedData.exp;
            handler.bind(this)( event, callback );

          } else {
            log.error(`clientID ${parsedData.aud} not authorized`);
            log.debug(parsedData);
            callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
          }
        } catch (e) {
          log.error(e.message);
          callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
        }
      }.bind(this));
    }.bind(this)).on('error', function(e){
      console.log(`Got error: ${e.message}`);
      callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
    });

  } else if( event.session ) {
    //console.log(event);
    if( event.session.application && event.session.application.applicationId
        && event.session.application.applicationId === this._config.alexa.applicationId  ) {
      handler.bind(this)( event, callback );

    } else if( event.session.application && event.session.application.applicationId ) {
      log.error( `applicationId ${event.session.application.applicationId} not authorized` );
      callback( createError(ERROR_INVALID_ACCESS_TOKEN) );

    } else {
      log.error( 'event not authorized' );
      callback( createError(ERROR_INVALID_ACCESS_TOKEN) );
    }

  } else {
    log.error( 'event not supported' );
    callback( createError(ERROR_UNSUPPORTED_OPERATION) );
  }

}

var in_session = false;
var handleCustom = function(event, callback) {
    var response = { version: '1.0',
                     sessionAttributes: {},
                     response: {
                       outputSpeech: {
                         type: 'PlainText',
                         text: 'Hallo.'
                       },
                       shouldEndSession: !in_session
                     }
                   };

log.info( event.request.type );
    if( event.request.type === 'LaunchRequest' ) {
      in_session = true;
      response.response.outputSpeech.text = 'Hallo. Hier ist dein FHEM.';
      response.response.outputSpeech.text = 'Hallo. Wie kann ich helfen?';
      response.response.reprompt = { outputSpeech: {type: 'PlainText', text: 'Noch jemand da?' } };

    } else if( event.request.type === 'SessionEndedRequest' ) {
      in_session = false;
      response.response.outputSpeech.text = 'Bye';

    } else if( event.request.type === 'IntentRequest' ) {
log.info( event.request.intent.name );
      var room;
      if( event.request.intent.slots && event.request.intent.slots.Room && event.request.intent.slots.Room.value ) {
        room = event.request.intent.slots.Room.value.toLowerCase();
      }

      var artikel='';
      if( event.request.intent.slots && event.request.intent.slots.artikel && event.request.intent.slots.artikel.value ) {
        artikel = event.request.intent.slots.artikel.value.toLowerCase();
      }

      var device_name;
      if( event.request.intent.slots && event.request.intent.slots.Device && event.request.intent.slots.Device.value ) {
        device_name = event.request.intent.slots.Device.value.toLowerCase();
      }


      var type;
      var device;
      if( device_name ) {
        device = this.devices[device_name];
        if( !device ) {
          for( name in this.devices ) {
            var d = this.devices[name];
            if( room && !d.isInRoom(room) ) continue;
            if( device_name === d.alexaName.toLowerCase() ) {
              if( device ) {
                if( room )
                  response.response.outputSpeech.text = `Ich habe mehr als ein Gerät mit Namen ${device_name} im Raum ${room} gefunden.`;
                else
                  response.response.outputSpeech.text = `Ich habe mehr als ein Gerät mit Namen ${device_name} gefunden. Welchen Raum meinst du?`;

                callback( response );
                return;
              }
              device = d;
            }
          }
        }
        if( !device ) {
          if( device_name === 'licht' || device_name === 'lampe' || device_name === 'lampen' ) {
            type = 'light';
            artikel = '';
            device_name = undefined;
          }

        }
        if( !device && !type ) {
          if( room )
            response.response.outputSpeech.text = `Ich habe kein Gerät mit Namen ${device_name} im Raum ${room} gefunden.`;
          else
            response.response.outputSpeech.text = `Ich habe kein Gerät mit Namen ${device_name} gefunden.`;

          callback( response );
          return;
        }
      }
log.debug('type: ' + type );
log.debug('room: ' + room );
log.debug('device_name: ' + device_name );
log.debug('device: ' + device );

      if( event.request.intent.name === 'AMAZON.StopIntent' ) {
        in_session = false;
        response.response.outputSpeech.text = 'Bis bald.';

      } else if( event.request.intent.name === 'AMAZON.HelpIntent' ) {
        response.response.outputSpeech.text = 'HILFE';

      } else if( event.request.intent.name === 'StatusIntent' ) {
        response.response.outputSpeech.text = '';
        function status(device, room) {
          var state = '';
          if( device.mappings.On ) {
            var current = device.fhem.reading2homekit(device.mappings.On, device.fhem.cached(device.mappings.On.informId));
            state = `ist ${current?'an':'aus'}`;
          }
          if( device.mappings.TargetTemperature ) {
            if( state ) state += ' und ';
            state += `steht auf ${device.fhem.cached(device.mappings.TargetTemperature.informId)} Grad`;

          }
          if( device.mappings.TargetPosition ) {
            if( state ) state += ' und ';
            state += `steht auf ${device.fhem.cached(device.mappings.TargetPosition.informId)} Prozent`;

          }
          if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] ) {
            if( state ) state += ' und ';
            state += `steht auf ${device.fhem.cached(device.mappings['00001001-0000-1000-8000-135D67EC4377'].informId)} Prozent`;
          }

          if( !state )
            return `Ich kann das Gerät mit Namen ${device.alexaName} nicht abfragen.`;

          var name = device.alexaName.toLowerCase();
          if( !room && device.room && this.roomsOfName &&  this.roomsOfName[name] && this.roomsOfName[name].length > 1 )
            return `${name} im Raum ${device.room} ${state}.`;

          return `${name} ${state}.`;
        }
        if( room || type || !device ) {
          for( name in this.devices ) {
            var device = this.devices[name];
            if( type && !device.isOfType(type) ) continue;
            if( room && !device.isInRoom(room) ) continue;

            if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ', ';
            response.response.outputSpeech.text += status.bind(this)(device, room);
          }
          if( room && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = `Ich habe keinen Raum ${room} mit Geräten ${type?'vom Typ '+event.request.intent.slots.Device.value.toLowerCase():''} gefunden.`;
          else if( type && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = `Ich habe keine Geräte vom Typ ${event.request.intent.slots.Device.value.toLowerCase()} gefunden.`;
          else {
            response.response.card = { type: 'Simple',
                                       title: `${room?room:''}status`,
                                       content: response.response.outputSpeech.text.replace( ', ', '\n' ).replace( ' und ', '\n' ) };
          }

        } else if( device ) {
          response.response.outputSpeech.text = status(device);

        } else {
          response.response.outputSpeech.text = 'Das habe ich leider nicht verstanden.';
        }

      } else if( event.request.intent.name === 'SwitchIntent' ) {
        function Switch(device,value,ok) {
          if( !device.mappings.On ) {
            return `Ich kann das Gerät mit Namen ${device_name} nicht ${value}schalten.`;

          } else if( value === 'aus' ) {
            device.command( device.mappings.On, 0 );
            return ok;

          } else if( value === 'an' || value === 'ein' ) {
            device.command( device.mappings.On, 1 );
            return ok;

          } else if( value === 'um' ) {
            var current = device.fhem.reading2homekit(device.mappings.On, device.fhem.cached(device.mappings.On.informId))
            device.command( device.mappings.On, current?0:1 );
            return ok.replace( 'umgeschaltet', (current?'ausgeschaltet':'eingeschaltet') );

          } else
            return `Ich kann das Gerät mit Namen ${device_name} nicht ${value}schalten.`;
        }
        response.response.outputSpeech.text = 'OK.';
        if( room && device_name )
          response.response.outputSpeech.text = `Ich habe ${artikel} ${device_name} im Raum ${room} ${event.request.intent.slots.Action.value}geschaltet.`;
        else if( device_name )
          response.response.outputSpeech.text = `Ich habe ${artikel} ${device_name} ${event.request.intent.slots.Action.value}geschaltet.`;

        if( (room || type) && !device ) {
          response.response.outputSpeech.text = '';
          for( name in this.devices ) {
            var device = this.devices[name];
            if( device_name && device_name !== device.alexaName.toLowerCase() ) continue;
            if( type && !device.isOfType(type) ) continue;
            if( room && !device.isInRoom(room) ) continue;

            response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
            if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
            response.response.outputSpeech.text += Switch( device, event.request.intent.slots.Action.value, `${artikel} ${device.alexaName}` );
          }
          if( room && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = `Ich habe keinen Raum ${room} mit Geräten ${type?'vom Typ '+event.request.intent.slots.Device.value.toLowerCase():''} gefunden.`;
          else if( type && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = `Ich habe keine Geräte vom Typ ${event.request.intent.slots.Device.value.toLowerCase()} gefunden.`;
          else {
            response.response.outputSpeech.text += ` ${event.request.intent.slots.Action.value}geschaltet.`;
            response.response.card = { type: 'Simple',
                                       title: `${room?room:''}status`,
                                       content: response.response.outputSpeech.text };
            response.response.outputSpeech.text = 'Ich habe ' + response.response.outputSpeech.text;
          }

        } else if( device ) {
          response.response.outputSpeech.text = Switch( device, event.request.intent.slots.Action.value, response.response.outputSpeech.text );

        } else
          response.response.outputSpeech.text = 'Ich habe kein Gerät gefunden.';

      } else if( event.request.intent.name === 'TemperaturIntent' || event.request.intent.name === 'TemperaturenIntent' ) {
        response.response.outputSpeech.text = '';
        for( name in this.devices ) {
          var device = this.devices[name];
          if( device.mappings.TargetTemperature ) {
            if( event.request.intent.slots && event.request.intent.slots.Device.value !== device.name
                                           && event.request.intent.slots.Device.value !== device.alexaName )
              next;

            if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ', ';
            response.response.outputSpeech.text += device.alexaName + ' ist auf ' + device.fhem.cached(device.mappings.TargetTemperature.informId) + ' grad gestellt';
          }
        }

      } else if( event.request.intent.name === 'DeviceListIntent' ) {
        response.response.outputSpeech.text = '';
        for( name in this.devices ) {
          var device = this.devices[name];
          if( room && !device.isInRoom(room) ) continue;
          response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
          if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
          response.response.outputSpeech.text += device.alexaName;
        }
        response.response.card = { type: 'Simple',
                                   title: 'Deviceliste',
                                   content: response.response.outputSpeech.text.replace( ', ', '\n' ).replace( ' und ', '\n' ) };
        response.response.outputSpeech.text = 'Ich kenne: '+response.response.outputSpeech.text;

      } else if( event.request.intent.name === 'RoomListIntent' ) {
        response.response.outputSpeech.text = '';
        var rooms = {};
        for( name in this.devices ) {
          var device = this.devices[name];
          if( !device.room ) continue;
          rooms[device.room] = device.room;
        }
        for( room in rooms ) {
          response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
          if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
          response.response.outputSpeech.text += room;
        }
        response.response.card = { type: 'Simple',
                                   title: 'Raumliste',
                                   content: response.response.outputSpeech.text.replace( ', ', '\n' ).replace( ' und ', '\n' ) };
        response.response.outputSpeech.text = 'Ich kenne: '+response.response.outputSpeech.text;

      } else {
        response.response.outputSpeech.text = 'Das habe ich leider nicht verstanden';

      }
    }

    response.response.shouldEndSession = !in_session;

    callback( response );
}

// entry
var handler = function(event, callback) {
  log2("Received Directive", event);

  var response = null;

  if( event.request ) {
    response = handleCustom.bind(this)(event, callback);
    return;
  }

  var requestedNamespace = event.header.namespace;

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
    discoveredAppliances: []
  };

  for( connection of this.connections ) {
    for( device of connection.devices ) {

      if( device.mappings.On
          || device.mappings.Brightness || device.mappings.TargetPosition
          || device.mappings['00001001-0000-1000-8000-135D67EC4377']
          || device.mappings.TargetTemperature ) {
        //console.log(device);
        var d = { applianceId: device.uuid_base.replace( /[^\w_\-=#;:?@&]/g, '_' ),
                  manufacturerName: 'FHEM'+device.type,
                  modelName: 'FHEM'+ (device.model ? device.model : '<unknown>'),
                  version: '<unknown>',
                  friendlyName: device.alexaName,
                  friendlyDescription: 'name: ' + device.name + ', alias: ' + device.alias + (device.room?', room: ' + device.room:''),
                  isReachable: true,
                  actions: [],
                  additionalApplianceDetails: { device: device.device },
                };

        if( device.mappings.On ) {
          d.actions.push( "turnOn" );
          d.actions.push( "turnOff" );
        }

        if( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings['00001001-0000-1000-8000-135D67EC4377'] ) {
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

  return createDirective(header, payload);

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

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return createError(ERROR_UNSUPPORTED_TARGET);

  device.command( device.mappings.On, 1 );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_TURN_ON);

  return createDirective(header, {});

}// handleControlTurnOn


var handleControlTurnOff = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  device.command( device.mappings.On, 0 );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_TURN_OFF);

  return createDirective(header, {});

}// handleControlTurnOff


var handleControlSetPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  device.command( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings['00001001-0000-1000-8000-135D67EC4377'], event.payload.percentageState.value );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_SET_PERCENTAGE);

  return createDirective(header, {});

}// handleControlSetPercentage


var handleControlIncrementPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current;
  if( device.mappings.Brightness ) {
    current = device.fhem.cached(device.mappings.Brightness.informId);
  } else if( device.mappings.TargetPosition ) {
    current = device.fhem.cached(device.mappings.TargetPosition.informId);
  } else if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] ) {
    current = device.fhem.cached(device.mappings['00001001-0000-1000-8000-135D67EC4377'].informId);
  }
  current = parseFloat( current );
  target = current + event.payload.deltaPercentage.value;
  if( target < 0 || target > 100 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: 0, maximumValue: 100});
  device.command( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings['00001001-0000-1000-8000-135D67EC4377'], target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_INCREMENT_PERCENTAGE);

  return createDirective(header, {});

}// handleControlIncrementPercentage


var handleControlDecrementPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current;
  if( device.mappings.Brightness ) {
    current = device.fhem.cached(device.mappings.Brightness.informId);
  } else if( device.mappings.TargetPosition ) {
    current = device.fhem.cached(device.mappings.TargetPosition.informId);
  } else if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] ) {
    current = device.fhem.cached(device.mappings['00001001-0000-1000-8000-135D67EC4377'].informId);
  }
  current = parseFloat( current );
  target = current - event.payload.deltaPercentage.value;
  if( target < 0 || target > 100 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: 0, maximumValue: 100});
  device.command( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings['00001001-0000-1000-8000-135D67EC4377'], target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_DECREMENT_PERCENTAGE);

  return createDirective(header, {});

}// handleControlDecrementPercentage


var handleControlSetTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = event.payload.targetTemperature.value;

  var min = device.mappings.TargetTemperature.minValue;
  if( min === undefined ) min = 15.0;
  var max = device.mappings.TargetTemperature.maxValue;
  if( max === undefined ) max = 30.0;

  if( target < min || target > max )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_SET_TARGET_TEMPERATURE);

  var payload = { targetTemperature: { value: target },
                  //temperatureMode: { value: 'AUTO' },
                  previousState: { targetTemperature: { value: current },
                                   //mode: { value: 'AUTO' },
                                 }
                };

  return createDirective(header, payload);

}// handleControlSetTargetTemperature


var handleControlIncrementTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = current + event.payload.deltaTemperature.value;

  var min = device.mappings.TargetTemperature.minValue;
  if( min === undefined ) min = 15.0;
  var max = device.mappings.TargetTemperature.maxValue;
  if( max === undefined ) max = 30.0;

  if( target < min || target > max )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_INCREMENT_TARGET_TEMPERATURE);

  var payload = { targetTemperature: { value: target },
                  //temperatureMode: { value: 'AUTO' },
                  previousState: { targetTemperature: { value: current },
                                   //mode: { value: 'AUTO' },
                                 }
                };

  return createDirective(header, payload);

}// handleControlIncrementTemperature


var handleControlDecrementTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = current - event.payload.deltaTemperature.value;

  var min = device.mappings.TargetTemperature.minValue;
  if( min === undefined ) min = 15.0;
  var max = device.mappings.TargetTemperature.maxValue;
  if( max === undefined ) max = 30.0;

  if( target < min || target > max )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_DECREMENT_TARGET_TEMPERATURE);

  var payload = { targetTemperature: { value: target },
                  //temperatureMode: { value: 'AUTO' },
                  previousState: { targetTemperature: { value: current },
                                   //mode: { value: 'AUTO' },
                                 }
                };

  return createDirective(header, payload);

}// handleControlDecrementTemperature


var handleUnsupportedOperation = function() {

  var header = createHeader(NAMESPACE_CONTROL,ERROR_UNSUPPORTED_OPERATION);

  return createDirective(header, {});

}// handleUnsupportedOperation


var handleUnexpectedInfo = function(fault) {

  var header = createHeader(NAMESPACE_CONTROL,ERROR_UNEXPECTED_INFO);

  var payload = {
    faultingParameter: fault
  };

  return createDirective(header, payload);

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
    name: name,
    payloadVersion: '2',
    namespace: namespace,
    messageId: createMessageId(),
  };

}// createHeader


var createDirective = function(header, payload) {

  return {
    header: header,
    payload: payload
  };

}// createDirective

var createError = function(error, payload) {

  if( payload === undefined )
    payload = {};

  return {
    header: createHeader(NAMESPACE_CONTROL, error),
    payload: payload,
  };
}// createError


var log2 = function(title, msg) {

  console.log('**** ' + title + ': ' + JSON.stringify(msg));

}// log
