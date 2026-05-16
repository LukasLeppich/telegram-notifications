# Telegram notification plugin

Subscribes to the `notifications.*` path in SignalK and sends updates to Telegram chats.

Provide command to request ship data from Telegram bot:
- batt: Get battery status
- wind: Get wind information
- anchor: Get anchor information

The commands only work when sent directly to the bot.
You can use the buttons in other chats to trigger a command.

## Installation:
Navigate to your SignalK directory (e.g. ~/.signalk) and install from github:

`npm i LukasLeppich/telegram-notifications`

Restart SignalK server.


## Configuration

The plugin has the following required options:

#### Token
The auth Token for your Telegram Bot account.
You can create a new Telegram Bot by chatting with: @BotFather (https://telegram.me/BotFather)

#### Recipients
A list of Telegram chat IDs to notify when this event occurs.

The chat ID can be found in the URL when opening Telegram in a web browser: https://web.telegram.org/
The id is after the # char (can be negative).
