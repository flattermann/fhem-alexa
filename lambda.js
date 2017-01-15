
const PORT=3000;
const HOST='mein.host.name';


// namespaces
const NAMESPACE_CONTROL = "Alexa.ConnectedHome.Control";
const NAMESPACE_DISCOVERY = "Alexa.ConnectedHome.Discovery";

// errors
const ERROR_TARGET_OFFLINE = "TargetOfflineError";

const ERROR_UNSUPPORTED_OPERATION = "UnsupportedOperationError";

const ERROR_UNEXPECTED_INFO = "UnexpectedInformationReceivedError";


// entry
exports.handler = function (event, context, callback) {

  log("Received Directive", event);
  
  var postData = JSON.stringify(event);
  
  var options = {
  hostname: HOST,
  port: PORT,
  //family: 6,
  rejectUnauthorized: false,
  path: '/upload',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  var http = require('https');
  var req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    res.setEncoding('utf8');
    var rawData = '';
    res.on('data', (chunk) => rawData += chunk);
    res.on('end', () => {
      console.log('No more data in response.');
      callback(null, JSON.parse(rawData) );
      return;
    });
  });

  req.on('error', (e) => {
    console.log(`problem with request: ${e.message}`);
    callback(null, createError(ERROR_TARGET_OFFLINE) );
    return;
  });

  // write data to request body
  req.write(postData);
  req.end();
  return;
  
}// exports.handler


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


var log = function(title, msg) {

  console.log('**** ' + title + ': ' + JSON.stringify(msg));

}// log
