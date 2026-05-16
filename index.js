/**
 * @import {ServerAPI, Plugin, Notification, Position, Delta} from '@signalk/server-api'
 * @import TelegramBot from '@types/node-telegram-bot-api'
 */
process.env.NTBA_FIX_319 = 1; // or require('dotenv').config();
const geolib = require('geolib');
const TelegramBot = require('node-telegram-bot-api');
const PLUGIN_ID = 'telegram-notifications';
const PLUGIN_NAME = 'Telegram notifications';
var unsubscribes = [];
/** @type {TelegramBot} */
var bot;
var chatIds;

var notificationCache = {}
/** @param {ServerAPI} app */
module.exports = function (app) {
  /** @type {Plugin} */
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = 'A plugin to send telegram notifications when an event occurs';

  /** @type {Command[]} */
  const commands = [
    { name: 'batt', description: 'Get battery status', execute: batteryCmd },
    { name: 'wind', description: 'Get wind information', execute: windCmd },
    { name: 'anchor', description: 'Get anchor information', execute: anchorCmd },
    { name: 'set', description: 'Set anchor: set 10 90 [max] (set 10 meters east of current position, optional max dist)', execute: setAnchorCmd },
    { name: 'unset', description: 'Unset anchor', execute: unsetAnchorCmd },
    { name: 'update', description: 'Update properties: update radius 10 (set max anchor radius to 10m) Properties: radius', execute: updateCmd },
    { name: 'help', description: 'List available commands', execute: helpCmd }
  ];

  plugin.start = function (options, restartPlugin) {
    plugin.options = options;
    chatIds = options.chatids;
    app.debug('Plugin started. Using chat ids: ' + chatIds.join(','));
    let token = options.bot.token;
    // Create a bot that uses 'polling' to fetch new updates
    bot = new TelegramBot(token, { polling: true });
    // app.debug('Options: ' + JSON.stringify(options));

    let localSubscription = {
      context: 'vessels.self', // Get data for all contexts
      subscribe: [{
        path: 'notifications.*', // Get all paths
        policy: 'instant',
      }]
    };

    app.subscriptionmanager.subscribe(
      localSubscription,
      unsubscribes,
      subscriptionError => {
        app.error('Error:' + subscriptionError);
      },
      delta => {
        delta.updates.forEach(update => {
          app.debug('u: ' + JSON.stringify(update));
          let messages = [];
          update.values.forEach(v => {
            let path = v.path;
            /** @type { Notification } */
            let value = v.value;
            let message = '[' + path + '] ' + value.state.toUpperCase() + ': ' + value.message;
            if (value.status.acknowledged) {
              message += ' (acknowledged)';
            } else if (value.status.silenced) {
              message += ' (silenced)';
            }
            if (notificationCache[path] !== message) {
              messages.push(message);
            }
            notificationCache[path] = message
          });
          if (messages.length == 0) {
            return;
          }
          let message = messages.join('\n');
          sendMessage(message);
        });
      }
    );


    bot.on('message', (msg) => {
      const command = msg.text.toLowerCase();
      const toExecute = commands.filter(cmd => cmd.execute(command, undefined));
      if (toExecute.length == 0) {
        sendMessage('Unknown command: ' + command +
          helpCmd('help', app) +
          "\n\nChat id: " + msg.chat.id,
          command);
        return;
      }
      toExecute.forEach(cmd => {
        try {
          let reply = cmd.execute(command, app);
          sendMessage(reply, msg.text);
        } catch (error) {
          const errMsg = 'Error occurred while executing command [' + command + ']:' + error.message
          app.error(errMsg, error);
          sendMessage(errMsg + "\nERROR: \n", JSON.stringify(error, null, 2), msg.text);
        }
      });
    });
    bot.on('polling_error', (error) => {
      app.error('Polling error occurred:', error);
      if (error.code === 'ETIMEDOUT') {
        app.debug('Attempting to restart polling after timeout...');
        setTimeout(() => {
          bot.startPolling();
        }, 5000); // Wait for 5 seconds before attempting to restart
      } else {
        // Handle other types of errors
      }
    });
    sendMessage('SignalK Telegram Bot started', 'init');
    app.setPluginStatus('Running');
  };



  function elementName(element) {
    if (typeof element.name != 'undefined') {
      let name = element.name.value;
      app.debug('name: ' + name);
      return (name + ' ');
    } else {
      return ('');
    };
  }

  function elementToString(object, type) {
    app.debug('type: ' + type + ' object: ' + JSON.stringify(object));
    var unis = object.meta.units;
    if (typeof type != 'undefined') {
      units = type
    }
    /** @type {number} */
    var value = object.value;
    if (typeof type == 'undefined' && (value == 0 || value == 1)) {
      units = 'bool'
    }
    app.debug('units: ' + units + ' value: ' + value);

    switch (units) {
      case 'K':
        return ((value - 273.15).toFixed(1) + '°C');
        break
      case 'rad':
        return ((value * 57.2958).toFixed(0) + '°');
        break
      case 'm/s':
        return ((value * 1.94384).toFixed(1) + 'kn');
        break
      case 'm':
        return ((value).toFixed(1) + 'm')
        break
      case 'stateOfCharge':
        return ((value * 100) + '%');
        break
      case 'ratio':
        return ((value * 100).toFixed(1) + '%');
        break
      case 'ration':
        return ((value * 100).toFixed(1) + '%');
        break
      case 'V':
        return (value.toFixed(1) + 'v');
        break
      case 'A':
        return (value.toFixed(1) + 'A');
        break
      case 'm3':
        return ('liter: ' + (value * 1000).toFixed(0));
        break
      case 'watt':
        return (value.toFixed(2) + ' Watt');
        break
      case 'chargingMode':
        return ('charging mode: ' + value);
        break
      case 'bool':
        if (value == 1) {
          return "on"
        } else if (value == 0) {
          return "off"
        }
        break
      default:
        return (value);
    }
  }


  function addElement(ElementList, element) {
    let newList = Object.assign(ElementList, element)
    return newList
  }

  function sendMessage(message, text) {
    app.debug('Message: %s text: %s', message, text)
    if (message == "") {
      message = ("No info for " + text)
    }
    chatIds.forEach(chatid => {
      app.debug('Sending ' + chatid + ': ' + message);
      bot.sendMessage(chatid, message, createChatButtons());
    });
  }

  function createChatButtons() {
    const opts = {
      reply_markup: {
        keyboard: [
          ['batt', 'wind', 'anchor'],
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    return opts;
  }

  plugin.stop = function () {
    if (bot) {
      bot.stopPolling()
        .then(() => {
          app.debug('Bot polling stopped');
        })
        .catch((err) => {
          app.error('Error stopping bot polling: ' + err);
        });
    }

    app.debug('Plugin stopped');
    unsubscribes.forEach(f => f());
    app.setPluginStatus('Stopped');
  };

  plugin.schema = {
    title: PLUGIN_NAME,
    type: 'object',
    properties: {
      bot: {
        type: 'object',
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            title: 'Telegram Bot Token'
          }
        },
      },
      chatids: {
        type: 'array',
        title: 'Chat ids to receive messages',
        required: ['chatids'],
        items: {
          type: 'number',
          title: 'Chat id'
        }
      }
    }
  };


  /**
   * @typedef {Object} Command
   * @property {string} name - The name of the command
   * @property {string} description - A description of the command
   * @property {CommandFn} execute - The function to execute when the command is called
   */

  /**
   * @typedef {(command: string, app: ServerAPI|undefined) => string|boolean} CommandFn
   */

  /** 
   * @type {CommandFn}
   */
  function batteryCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('batt');
    }
    const batteries = app.getSelfPath('electrical.batteries');
    if (!batteries) {
      return "Battery information not available";
    }
    const replies = [];
    Object.entries(batteries).forEach(([key, element]) => {
      let reply = key + ': ';
      if (typeof element.capacity.stateOfCharge != 'undefined') {
        reply += elementToString(element.capacity.stateOfCharge, 'stateOfCharge') + ", ";
      }
      reply += elementToString(element.voltage, 'V');
      if (typeof element.power != "undefined") {
        reply += ", " + elementToString(element.power, 'watt');
        element.power.value = element.power.value / 12;
        reply += " (" + elementToString(element.power, 'A') + ")";
      }
      replies.push(reply);
    });
    if (replies.length == 0) {
      return 'No battery information available';
    }
    return replies.join('\n');
  }

  /** @type {CommandFn} */
  function windCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('wind');
    }
    const windData = app.getSelfPath('environment.wind');
    const replies = [];
    Object.entries(windData).forEach(([key, element]) => {
      let reply = "";
      switch (key) {
        case 'directionTrue':
          reply += 'True wind direction: ' + elementToString(element, 'rad');
          break;
        case 'angleApparent':
          reply += 'Apparent wind direction: ' + elementToString(element, 'rad');
          break;
        case 'speedApparent':
          reply += 'Apparent wind speed: ' + elementToString(element, 'm/s');
          break;
        default:
          reply += key + ': ' + elementToString(element);
      }
      replies.push(reply);
    });
    if (replies.length == 0) {
      return 'No wind information available';
    }
    return replies.join('\n');
  }

  /** @type {CommandFn} */
  function anchorCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('anchor');
    }
    let replies = [];
    const anchorPosition = app.getSelfPath('navigation.anchor.position');
    if (!anchorPosition || anchorPosition.value == null) {
      return 'Anchor is not set';
    }
    const anchorData = app.getSelfPath('navigation.anchor');
    Object.entries(anchorData).forEach(([key, element]) => {
      switch (key) {
        case "currentRadius":
          replies.push("Current distance: " + elementToString(element, 'm'));
          break;
        case "maxRadius":
          replies.push("Max distance: " + elementToString(element, 'm'));
          break;
        case "bearingTrue":
          replies.push("Bearing: " + elementToString(element, 'rad'));
          break;
      }
    });
    /** @type {Notification} */
    const anchorState = app.getSelfPath('notifications.navigation.anchor');
    if (anchorState) {
      replies.push("Anchor state: " +
        anchorState.value.state.toUpperCase() + ' - ' + anchorState.value.message);
    }
    if (replies.length == 0) {
      return 'No anchor information available';
    }
    return replies.join('\n');
  }
  /** @type {CommandFn} */
  function setAnchorCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('set');
    }
    const parts = input.split(' ');
    if (parts.length < 3 || parts.length > 4) {
      return 'Usage: set <distInMeter> <baringInDegree> [max]';
    }
    const distance = parseInt(parts[1]);
    const bearing = parseInt(parts[2]);
    let maxRadius;
    if (parts.length > 3) {
      maxRadius = parseInt(parts[3]);
    } else {
      maxRadius = Math.round(distance == 0 ? 5 : distance * 1.2);
    }
    const posValue = app.getSelfPath('navigation.position');
    if (!posValue || posValue.value == null) {
      return 'Current position not available';
    }
    const depthValue = app.getSelfPath("environment.depth.belowTransducer");
    let depth = 0;
    if (depthValue && depthValue.value != null) {
      depth = depthValue.value;
    }
    /** @type {Position} */
    const position = posValue.value;
    const anchorPosition = geolib.computeDestinationPoint(position, distance, bearing);
    anchorPosition.altitude = -depth;
    app.putSelfPath('navigation.anchor.position', anchorPosition);
    app.putSelfPath('navigation.anchor.maxRadius', maxRadius);
    return 'Set anchor in ' + distance + 'm at bearing ' + bearing + '° (max radius: ' + maxRadius + 'm)\n' +
      '  Long: ' + anchorPosition.longitude.toFixed(5) + '\n' +
      '  Lat: ' + anchorPosition.latitude.toFixed(5) + '\n' +
      '  Depth: ' + (anchorPosition.altitude.toFixed(1) * -1) + 'm';
  }

  /** @type {CommandFn} */
  function updateCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('update');
    }
    const parts = input.split(' ');
    if (parts.length != 3) {
      return 'Usage: update <property> <value>';
    }
    const property = parts[1].toLowerCase();
    const value = parts[2];
    switch (property) {
      case 'radius':
        const radius = parseInt(value);
        app.putSelfPath('navigation.anchor.maxRadius', radius);
        return 'Updated max anchor radius to ' + radius + 'm';
      default:
        return 'Unknown property: ' + property;
    }
  }

  /** @type {CommandFn} */
  function unsetAnchorCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('unset');
    }
    app.putSelfPath('navigation.anchor.position', null);
    return 'Anchor unset';
  }


  function helpCmd(input, app) {
    if (typeof app == 'undefined') {
      return input.startsWith('help');
    }
    return 'Available commands: \n' +
      commands.map(cmd => "  " + cmd.name + " - " + cmd.description).join('\n');
  }
  return plugin;
};
