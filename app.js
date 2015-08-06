// set up

var port = process.env.PORT;
var botName = process.env.TWITTER_SCREEN_NAME;

var express = require('express');
var app = express();
var mongoose = require('mongoose');
var morgan = require('morgan');
var _ = require('underscore');
var dbConnection = require('./database/databasemanager');
var User = require('./database/user');
var Twitter = require('twitter');
var FollowerBot = require('./bot');

var workQueue = [];

// add morgan for logging
app.use(morgan('dev'));


var twitterBotClient = new Twitter({
    consumer_key: process.env.BOT_TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.BOT_TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.BOT_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.BOT_ACCESS_TOKEN_SECRET,
});


var getTasks = function(callback) {

    User.find({}, function(err, userSet) {

        if(err) callback(err);

        else {

            var tasks = [];

            _.each(userSet, function(user) {

                var taskSubmitted;

                _.each(user.requests, function(request) {

                    // if there is no status, add to work queue...
                    if(!request.status && !taskSubmitted) {

                        taskSubmitted = true;

                        tasks.push({
                            user: user,
                            request: request
                        });

                    }

                });

            });

            // filter out the case where this user already has a task waiting...
            tasks = _.filter(tasks, function(task) {

                var alreadyWorking = _.find(workQueue, function(item) {

                    return item.requestingUser.toString() == task.user._id.toString()

                });

                return !alreadyWorking;

            });


            // sort the tasks so we see the oldest unfinished tasks first...
            tasks = _.sortBy(tasks, function(task) {
                return task.request.requestTime;
            });

            callback(null, tasks);

        }

    });

};

var submitWorkTasks = function(sortedWorkTasks, callback) {

    // while we're not at the workQueue limit, enqueue tasks...
    while(workQueue.length < 25 && !_.isEmpty(sortedWorkTasks)) {

        // grab the first task...
        var thisTask = sortedWorkTasks.shift();

        var timeSubmitted = new Date();

        var thisWorkRandomString = ('xxxxxxxxxxxxxxxxx'.replace(/[x]/g, function(c) {
                var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
                return v.toString(16);
            }));

        // push the task into the work queue
        workQueue.push({

            timeSubmitted: timeSubmitted, // mark the time so we can trim problematic tasks if we need to...

            id: thisWorkRandomString,

            requestingUser: thisTask.user._id,

            // set the actual function, give it a callback of saving and dequeueing the work...
            workingFunction: FollowerBot.getFollowerData({

                twitterScreenName: thisTask.request.request,

                twitterConfig: {
                    consumer_key: process.env.TWITTER_CONSUMER_KEY,
                    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
                    access_token_key: thisTask.user.twitter.token,
                    access_token_secret: thisTask.user.twitter.tokenSecret
                },

                id: thisWorkRandomString,

                request: thisTask.request,

                user: thisTask.user,

            }, function(err, options, result) {

                // if error, dequeue and report the error...
                if(err && err[0] && err[0].code == 34) {

                    var thisWorkQueueTask = _.findWhere(workQueue, { id: options.id });
                    workQueue = _.without(workQueue, thisWorkQueueTask);

                    var tweet = '@' + options.user.twitter.username + ', we had some trouble with this request. Try again with a new username.';

                    twitterBotClient.post('/statuses/update', {
							in_reply_to_status_id: options.request.tweetID,
							status: tweet
					}, function(err, result) {
                        console.log('Tweet sent: ' + tweet);
                    });

                    // mark the change and finish the save operation...
                    options.request.status = 'failed';

                    options.user.save();


                }

                else if(err) {


                    console.log('logging error here');
                    console.log(err);

                    options.request.status = 'failedunknown';

                    options.user.save();
                }

                else {

                    var thisWorkQueueTask = _.findWhere(workQueue, { id: options.id });

                    workQueue = _.without(workQueue, thisWorkQueueTask);


                    var pctActive = Math.floor(result.monthlyActive / (result.monthlyActive + result.monthlyInactive) * 10000);

                    var pctActiveQuality = Math.floor(result.monthlyActiveQuality / (result.monthlyActive + result.monthlyInactive) * 10000);


                    var tweet = '@' + options.user.twitter.username + ' about ' + (pctActive/100) +
                        '% of their followers are active (MAUs), and about ' + (pctActiveQuality/100) + '% are quality active users.';


                    twitterBotClient.post('/statuses/update', {
							in_reply_to_status_id: options.request.tweetID,
							status: tweet
					}, function(err, result) {
                        console.log('Tweet sent: ' + tweet);
                    });


                    // mark the change and finish the save operation...
                    options.request.status = 'completed';

                    options.user.save();

                }

            }),

        });

    }

    callback();

};

var doWork = function() {

    getTasks(function(err, sortedWorkTasks) {

        submitWorkTasks(sortedWorkTasks, function() {

            console.log('Current Work queue length: ' + workQueue.length);

            setTimeout(function() {
                doWork();
            }, 30000);

        });

    });

};

//On successful connect
dbConnection.on('connected', function() {

    // serve the routes
    app.get('*', function(req, res) {
        res.sendStatus(200);
    });

    doWork();

    // create the servers
    app.listen(port);
    console.log('Server started...');

});
