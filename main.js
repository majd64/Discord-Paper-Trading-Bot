//v1.0.0
const Discord = require('discord.js');
const axios = require('axios');
require('custom-env').env('staging');
let models = require("./models");
const mongoose = require("mongoose");
const util = require("./util");

const client = new Discord.Client();
client.login(process.env.LOGIN);
client.once('ready', () => {
  console.log("Paper Trading Bot is running");
});

mongoose.connect("mongodb+srv://admin:" + process.env.ATLASPASSWORD + "@cluster0.xpbd4.mongodb.net/" + process.env.ATLASUSER, {useNewUrlParser: true, useUnifiedTopology: true});

const formatter = new Intl.NumberFormat('en-US', {style: 'currency',currency: "USD",minimumFractionDigits: 5});

const prefix = "!";
const color = "#9b59b6"

client.on ('message', async message => {
  if (!message.content.startsWith(prefix)) return

  console.log(message.content)

  var user = await models.User.findOne({'id': message.author.id}).exec();
  if (user == null){
    const newUser = new models.User({
      id: message.author.id,
      usdbalance: 10000,
      wallet: [],
      openOrder: undefined,
      orderHistory: []
    });
    user = newUser;
  }

  await user.save();

  const args = message.content.slice(prefix.length).split(" ");
  const command = args.shift().toLowerCase();

  if (command === "price"){
    price(args[0], price => {
      if (!price){
        message.channel.send("Invalid symbol")
        return
      }
      message.channel.send(formatter.format(price))
    })
  }

  else if (command === "buy"){
    res = await createOrder("marketbuy", user, args, message)
  }

  else if (command === "sell"){
    res = await createOrder("marketsell", user, args, message)
  }

  else if (command === "yes"){
    let order = user.openOrder
    if (!user.openOrder.amount){
      return message.channel.send("No open orders")
    }
    console.log(order.date)
    console.log(Math.round(Date.now() / 1000))
    if (order.date < (Math.round(Date.now() / 1000) - 60)){
      user.openorder = undefined
      return message.channel.send("Order expired")
    }

    if (order.order === "marketbuy"){
      if (order.amount * order.price > user.usdbalance){
        message.channel.send("Not enough funds")
        return
      }
      user.usdbalance = user.usdbalance - order.amount * order.price
      const index = user.wallet.findIndex(x => x.symbol === order.symbol)

      if (index === -1){
        user.wallet.push({symbol: order.symbol, amount: order.amount})
      }else{
        user.wallet[index].amount += order.amount
      }
    }

    else if (order.order === "marketsell"){
      const index = user.wallet.findIndex(x => x.symbol === order.symbol)

      coin = user.wallet[index]

      if (order.amount === -1){
        order.amount = coin.amount
      }

      if (order.amount > coin.amount){
        message.channel.send("Not enough funds")
        return
      }
      user.usdbalance = user.usdbalance + (order.amount * order.price)

      user.wallet[index].amount = user.wallet[index].amount - order.amount

      if (user.wallet[index].amount === 0){
        user.wallet.splice(index, 1);
      }
    }

    user.orderHistory.push(user.openOrder)

    user.openOrder = undefined
    await user.save();
    message.channel.send("Success!")
  }

  else if (command === "no"){
    user.openOrder = undefined
    await user.save();
    message.channel.send("order canclled")
  }

  else if (command === "wallet"){
    var itemsImbed = new Discord.MessageEmbed()

    values(user.wallet, wallet => {
      itemsImbed.addField("Total wallet value", formatter.format(wallet.total + user.usdbalance));
      itemsImbed.addField("USD", formatter.format(user.usdbalance));
      itemsImbed.setColor(color)


      wallet.wallet.forEach((coin, j) => {
        itemsImbed.addField(`${coin.symbol}`, `Amount: ${coin.amount}\n value: ${formatter.format(coin.amount * coin.price)}`);
      });
      message.channel.send(itemsImbed)
    })
  }

  else if (command === "history"){
    var itemsImbed = new Discord.MessageEmbed()
  	.setColor(color)
    user.orderHistory.forEach((order, j) => {
      var string = ""
      itemsImbed.addField(`${order.order === "marketbuy" ? "Buy" : "Sell"} ${order.symbol}`, `Price: ${order.price}\nAmount: ${order.amount}\nTotal: ${order.price * order.amount}`);
      if(itemsImbed.fields.length === 25){
        message.channel.send(itemsImbed);
        itemsImbed = new Discord.MessageEmbed()
        .setColor(color);
      }
    });
    message.channel.send(itemsImbed);
  }

  else if (command === "help"){
    const fields = [{ name: '.price [symbol]', value: "Returns price of a coin", inline: false},
    { name: '.wallet', value: "Shows wallet value, balance and all coins", inline: false},
    { name: '.buy [symbol] [amount]', value: "Buys a coin", inline: false},
    { name: '.sell [symbol] [amount]', value: "Sells a coin", inline: false}]
    const helpEmbed = new Discord.MessageEmbed()
    helpEmbed.setColor(color)
    helpEmbed.fields = fields

    message.channel.send(helpEmbed)

  }
});

async function createOrder(orderType, user, args, message){
  user.openOrder = undefined;

  const input = util.parseInput(args)

  if (!input){
    return message.channel.send(`Invalid input. To buy use the command *${prefix}buy 100 ada*`)
  }

  input.symbol = input.symbol.toUpperCase()

  price(input.symbol, async price => {
    if (!price){
      return message.channel.send("Invalid symbol")
    }

    let index;

    if (orderType === "marketsell"){
      index = await user.wallet.findIndex(x => x.symbol.toUpperCase() === input.symbol.toUpperCase())
      if (index === -1){
        return message.channel.send(`You have no ${input.symbol}`)
      }
    }

    if (input.amount === -1){
      if (orderType === "marketbuy"){
        input.amount = user.usdbalance / price
      }else{
        input.amount = user.wallet[index].amount
      }
    }

    user.openOrder = {order: orderType, symbol: input.symbol, amount: input.amount, price: price, date: Math.round(Date.now() / 1000)}
    user.save();
    return message.channel.send(`Are you sure you want to ${orderType === "marketbuy" ? "buy" : "sell"} ${input.amount} ${input.symbol}. Price of ${input.symbol} is ${formatter.format(price)}. Total will be ${formatter.format(price * input.amount)}. (${prefix}yes or ${prefix}no)`)
  })
}

function price(symbol, callback){
  axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}USDT`)
    .then(res => {
      if (!res.data.price){
        console.log("nono1")
        axios.get(`https://api.kucoin.com/api/v1/prices?currencies=${symbol.toUpperCase()}`)
          .then(res => {
            console.log("n word")
            if (!res.data.data[symbol.toUpperCase()]){
              return callback(null)
            }
            callback(res.data.data[symbol.toUpperCase()])
          })
          .catch(err => {
            return callback(null)
          })
      }
      callback(res.data.price)
    })
    .catch(err => {
      console.log("nono2")
      axios.get(`https://api.kucoin.com/api/v1/prices?currencies=${symbol.toUpperCase()}`)
        .then(res => {
          if (!res.data.data[symbol.toUpperCase()]){

            return callback(null)
          }
          callback(res.data.data[symbol.toUpperCase()])
        })
        .catch(err => {
          return callback(null)
        })
    })
}

function values(wallet, callback){
  const newWallet = JSON.parse(JSON.stringify(wallet));
  var total = 0;
  let counter = 0;
  if (newWallet.length === 0){
    return callback({wallet: [], total: total})
  }
  newWallet.forEach((coin, i) => {
    price(coin.symbol, price => {
      counter += 1
      newWallet[i].price = price
      total = total + (parseFloat(price) * coin.amount)
      if (counter == newWallet.length){
        return callback({wallet: newWallet, total: total})
      }
    })
  });
}