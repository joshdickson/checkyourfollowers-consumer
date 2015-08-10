/**
 * A Twitter bot for seeing the skew of MAU among an account's followers
 */

var Twitter = require('twitter'),
    _ = require('underscore');

var getFollowerIDs = function(params, client, callback) {

    // get a random token set...
    var randomTokenSet = _.sample(client);

    // client is now the credential set, so first build the actual client and then try the request...
    var twitterClient = new Twitter({
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        access_token_key: randomTokenSet.token,
        access_token_secret: randomTokenSet.tokenSecret
    });

    twitterClient.get('/followers/ids', params, function(err, response) {

        if (err) return callback(err);

        var followerIDs = response.ids; // this is an array of followers...

        var nextCursorString = response.next_cursor_str;

        callback(null, {
            nextCursorString: nextCursorString,
            idSet: followerIDs
        });

    });

};

var saturateFollowersFromIDs = function(params, client, callback) {

    // get a random token set...
    var randomTokenSet = _.sample(client);

    // client is now the credential set, so first build the actual client and then try the request...
    var twitterClient = new Twitter({
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        access_token_key: randomTokenSet.token,
        access_token_secret: randomTokenSet.tokenSecret
    });

    twitterClient.post('/users/lookup', params, function(err, users) {

        if (err) return callback(err);

        else callback(null, {
            users: users
        });

    });

};

var getHeuristics = function(user) {

    var isActive,
        days;

    if (user.status) {
        var lastTweetDate = new Date(user.status.created_at);

        var diffMS = new Date() - lastTweetDate;
        days = Math.floor(diffMS / 3600000 / 24);

        if (days <= 30) isActive = true;

    }

    // MAU, DAU,
    return {
        lastTweetDaysAgo: days,
        isMonthlyActive: isActive,
        lowTweetCount: user.statuses_count < 10,
        lowFavoriteCount: user.favourites_count < 5,
        lowFollowingCount: user.friends_count < 10,
        highFollowingToFollowerCount: (user.friends_count / user.followers_count) > 5 && user.friends_count > 500 ? true : false,
        highFollowingCount: user.friends_count > 4000
    }

};

var isQualityUser = function(user) {

    var heuristics = getHeuristics(user);

    return !(heuristics.highFollowingToFollowerCount || heuristics.lowTweetCount || heuristics.lowFavoriteCount || heuristics.highFollowingCount || heuristics.lowFollowingCount || (heuristics.lastTweetDaysAgo > 7));

};

var isMonthlyActive = function(user) {

    var heuristics = getHeuristics(user);

    return heuristics.isMonthlyActive;

};

var processUsers = function(userSet, options) {
    _.each(userSet, function(user) {

        if (isMonthlyActive(user)) {

            if (isQualityUser(user)) options.monthlyActiveQuality++;


            options.monthlyActive++;

        } else {

            options.monthlyInactive++;


        }

    });
};


/**
 * Given a full followerIDs list, get info on all those tweeters...
 */
crawlActiveFollowersFromIDs = function(idSet, options, callback) {

    if (idSet.length > 100) {

        //  console.log('Crawling w/ idSet of : ' + idSet.length);

        // take the first 100 & update idSet to call it again...
        var subset = idSet.splice(0, 100);

        saturateFollowersFromIDs({
            user_id: subset.join()
        }, options.client, function(err, response) {

            if (err && err[0] && (err[0].code == 88 || err[0].code == 89)) {

                crawlActiveFollowersFromIDs(idSet, options, callback);

            } else if (err) {

                callback(err);

            } else {

                processUsers(response.users, options);

                crawlActiveFollowersFromIDs(idSet, options, callback);

            }

        });

    } else {

        saturateFollowersFromIDs({
            user_id: idSet.join()
        }, options.client, function(err, response) {

            if (err && err[0] && (err[0].code == 88 || err[0].code == 89)) {

                crawlActiveFollowersFromIDs(idSet, options, callback);

            } else if (err) {

                callback(err);

            } else {

                processUsers(response.users, options);

                callback(null, options);


            }

        });


    }

};

var crawlFollowerIDs = function(params, client, callback) {


    getFollowerIDs(params, client, function(err, response) {

        if (err && err[0] && err[0].code == 88)
            crawlFollowerIDs(params, client, callback);

        else if (err) callback(err);

        else callback(null, response);

    });

};



// function takes in a set of info & cursors and trackers, then gets the request and fills it, then either calls itself
// if there is another cursor, or calls the final callback with the end result
var runQueryForCursor = function(twitterName, cursor, client, solutionSet, callback) {

    console.log(twitterName + ' - cursor: ' + cursor);

    // do work...
    crawlFollowerIDs({
            screen_name: twitterName,
            cursor: cursor,
            stringify_ids: true
        },
        client,
        function(err, response) {

            if (err && err[0] && err[0].code == 89) {

                runQueryForCursor(twitterName, cursor, client, solutionSet, callback);

            }

            else if (err) return callback(err);

            else {

                crawlActiveFollowersFromIDs(response.idSet, {
                    client: client,
                    monthlyActive: 0,
                    monthlyInactive: 0,
                    monthlyActiveQuality: 0,

                }, function(err, results) {

                    // bad token, just try again w/ someone else's tokens
                    if (err && err[0] && err[0].code == 89) {

                        runQueryForCursor(twitterName, cursor, client, solutionSet, callback);

                    } else if (err) {

                        runQueryForCursor(twitterName, cursor, client, solutionSet, callback);

                    }

                    else if (response.nextCursorString != '0') {

                        solutionSet.monthlyActive += results.monthlyActive;
                        solutionSet.monthlyInactive += results.monthlyInactive;
                        solutionSet.monthlyActiveQuality += results.monthlyActiveQuality;

                        runQueryForCursor(twitterName, response.nextCursorString, client, solutionSet, callback);

                    } else {

                        solutionSet.monthlyActive += results.monthlyActive;
                        solutionSet.monthlyInactive += results.monthlyInactive;
                        solutionSet.monthlyActiveQuality += results.monthlyActiveQuality;

                        callback(null, solutionSet);

                    }

                });

            }

        }
    );

};



module.exports = {

    getFollowerData: function(options, callback) {

        var twitterName = options.twitterScreenName;

        var client = options.credentialSet;

        runQueryForCursor(twitterName, -1, client, {
            monthlyActive: 0,
            monthlyInactive: 0,
            monthlyActiveQuality: 0
        }, function(err, response) {

            if (err) {
                console.log('error logging...');
                console.log(err);
            } else {

                callback(null, options, response);

            }




        })

    }


};
