
var walk = require('walk'),
    fs = require('fs'),
    file = require('file'),
    path = require('path'),
    _ = require('underscore'),
    twitter = require('mtwitter'),
    crc = require('crc'),
    querystr = require('querystring'),
    nconf = require('nconf'),
    deltaLink,
    options, 
    walker, 
    twit;


function twitterSource(ins, outs, executor, config, cb) {
    if (!twit) {
       nconf.file({
          file: 'twitter.conf.json',
          dir: '..',
          search: true
       });
       var configuration = {
           consumer_key: nconf.get('consumer_key'), 
	   consumer_secret: nconf.get('consumer_secret'),
	   access_token_key: nconf.get('access_token_key'),
	   access_token_secret: nconf.get('access_token_secret')
       };

       twit = new twitter(configuration);
    }

    var options = {};
    if (deltaLink) {
        options = querystr.parse(deltaLink.substr(1));
    } else {
        options = { q: 'krakow OR krakowie OR cracow' };
    }

    twit.get('/search/tweets', options, function(err, data, response) {
        console.log("TWIT GET, query:", options);
        if (err) {
            console.log(err);
            return cb(err);
        } else {
            deltaLink = data.search_metadata.refresh_url;
            outs[0].data = [];
            console.log("TWEETS retrieved:", data.statuses.length);
            data.statuses.forEach(function(t) {
                outs[0].data.push(t);
                //console.log(JSON.stringify(parsedTweet, null, 2))
            });
            cb(null, outs);
        }
    });
}


function partitionTweets(ins, outs, executor, config, cb) {
    //console.log(JSON.stringify(ins, null, 2));
    if (ins[0].data.length == 0)
        return cb(null, outs); 
    console.log("Partitioning tweets:", ins[0].data.length);
    var tweet = ins[0].data[0];
    var n = (crc.crc32(tweet.text)>>>0) % (outs.length);
    outs[n].condition = "true"; // this tweet will be forwarded to n-th output port (mapper)
    outs[n].data = [];
    outs[n].data.push(tweet);
    cb(null, outs);
}


function generateTweetStats(ins, outs, executor, config, cb) {
    var tweet = ins[0].data[0];
    var parsedTweet = {};
    var text = tweet.text;
    uris = text.match(/[A-Za-z]+:\/\/[A-Za-z0-9-_]+\.[A-Za-z0-9-_:%&~\?\/.=]+/g);
    text = text.replace(/[A-Za-z]+:\/\/[A-Za-z0-9-_]+\.[A-Za-z0-9-_:%&~\?\/.=]+/g, "");
    var usernames = text.match(/[@]+[A-Za-z0-9-_]+/g);
    text = text.replace(/[@]+[A-Za-z0-9-_]+/g, "");
    var hashtags = text.match(/[#]+[A-Za-z0-9-_]+/g);
    text = text.replace(/[#]+[A-Za-z0-9-_]+/g, "");
    var words = text.match(/[a-zA-Z_-\u0104\u0106\u0118\u0141\u00d3\u015a\u0179\u017b\u0143a-z\u0105\u0107\u0119\u0142\u00f3\u015b\u017a\u017c\u01440-9]{2,}/g);
    parsedTweet.uris = uris;
    parsedTweet.usernames = usernames;
    parsedTweet.hashtags = hashtags;
    parsedTweet.words = words;

    var n = (crc.crc32(tweet.text)>>>0) % outs.length;
    outs[n].condition = "true"; // this tweet will be forwarded to n-th output port (reducer)
    outs[n].data = [];
    outs[n].data.push(tweet);
    outs[n].data = [];
    outs[n].data.push(parsedTweet);
    cb(null, outs);
}

function aggregateTweetStats(ins, outs, executor, config, cb) {
    var tweet = ins[0].data;
    console.log(tweet);
    outs[0].data = tweet;
    cb(null, outs);
}

/*
function partitionFiles(ins, outs, executor, config, cb) {
    var dir = ins[0].dir;
    var files = [];

    walker = walk.walk(dir, { followLinks: false });

    walker.on("file", function (root, fileStats, next) {
        files.push({ "file": path.join(root, fileStats.name) });
        next();
    });

    walker.on("errors", function (root, nodeStatsArray, next) {
        next();
    });

    walker.on("end", function() {
        var i, j, k, chunk, chunkSize;
        chunkSize = files.length / outs.length;  
        for (i=0,k=0,j=files.length; i<j; i+=chunkSize, k++) {
            chunk = files.slice(i,i+chunkSize);
            outs[k].data = chunk;
        }
        cb(null, outs);
    });
}


function wordCounter(ins, outs, executor, config, cb) {
    var words = ins[0].value.match(/\w+/g);
    words = _.countBy(words, function(x) { return x; });
    console.log(words);
}
*/

exports.twitterSource = twitterSource;
exports.partitionTweets = partitionTweets;
exports.generateTweetStats = generateTweetStats;
exports.aggregateTweetStats = aggregateTweetStats;
