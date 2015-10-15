'use strict';

var _ = require('underscore');
var fs = require('fs');

var mkdirp = require('mkdirp');
mkdirp(process.env.HOME + '/.triviabot');

var questions = JSON.parse(fs.readFileSync(process.env.HOME + '/.triviabot/questions.json'));

var highScores = {};
try {
    highScores = JSON.parse(fs.readFileSync(process.env.HOME + '/.triviabot/highscores.json'));
} catch(e) {
    console.log('unable to find highscores, will start without them!');
}

var hintTime = 12000;
var intermissionTime = 5000;

var states = {};

var sendHint = function(chat) {
    var gs = states[chat];
    var answer = gs.question.answers[0];

    var remainingChars = _.difference(_.range(answer.length), gs.hintChars);
    remainingChars = _.shuffle(remainingChars);

    // reveal 1/4 of remaining characters
    var numChars = Math.ceil(remainingChars.length / 4);

    for (var i = 0; i < numChars; i++) {
        gs.hintChars.push(remainingChars[i]);
    }

    var hint = answer;

    for (var i = 0; i < hint.length; i++) {
        // character is not in hintChars, obfuscate it
        if (gs.hintChars.indexOf(i) === -1) {
            hint = hint.substr(0, i) + '*' + hint.substr(i + 1);
        }
    }

    gs.numHints++;

    if (gs.numHints > 2) {
        bot.sendMessage({
            text: 'Time\'s up! The answer was: "' + answer + '"',
            chat_id: chat
        });

        printStandings(chat);
        gs.active = false;
        setTimeout(function() {
            nextRound(chat);
        }, intermissionTime);
    } else {
        bot.sendMessage({
            text: 'Hint: ' + hint,
            chat_id: chat
        });

        gs.hintTimeout = setTimeout(function() {
            sendHint(chat);
        }, hintTime);
    }
};

var printStandings = function(chat) {
    var gs = states[chat];

    if (!_.keys(gs.scores).length) {
        return;
    }

    var standings = '';

    var scores = [];

    _.each(_.keys(gs.scores), function(id) {
        scores.push(gs.scores[id]);
    });

    scores = _.sortBy(scores, 'score');

    _.each(scores, function(score) {
        standings += score.firstName + ': ' + score.score + '\n';
    })

    bot.sendMessage({
        text: 'Current standings: \n' + standings,
        chat_id: chat
    });
};

var nextRound = function(chat) {
    var gs = states[chat];

    clearTimeout(gs.hintTimeout);
    gs.hintTimeout = null;

    gs.round++;
    gs.active = true;

    if (gs.round > 10) {
        var s = '';

        if (_.keys(gs.scores).length) {
            var standings = '';

            var scores = [];

            _.each(_.keys(gs.scores), function(id) {
                scores.push(gs.scores[id]);
            });

            scores = _.sortBy(scores, 'score');

            if (!scores[0].score) {
                s = 'Nobody scored any points!';
            } else if (scores[1] && scores[0].score === scores[1].score) {
                s = 'It\'s a draw!';
            } else {
                s = scores[0].firstName + ' wins the game!';

                if (!highScores[chat]) {
                    highScores[chat] = {};
                }
                if (!highScores[chat][scores[0].id]) {
                    highScores[chat][scores[0].id] = {
                        firstName: scores[0].firstName,
                        lastName: scores[0].lastName,
                        score: 0
                    };
                }

                highScores[chat][scores[0].id].score++;

                fs.writeFileSync(process.env.HOME + '/.triviabot/highscores.json', JSON.stringify(highScores));
            }

            s += '\n\nHighscores for this group:\n\n';

            if (_.keys(highScores[chat]).length) {
                var scores = [];

                _.each(_.keys(highScores[chat]), function(id) {
                    scores.push(highScores[chat][id]);
                });

                scores = _.sortBy(scores, 'score');

                for (var i = 0; i < 10 && i < scores.length; i++) {
                    var score = scores[i];
                    s += (i + 1) + ': ' + score.firstName + ': ' + score.score + '\n';
                }
            }
        }

        bot.sendMessage({
            text: 'Game over! ' + s,
            chat_id: chat
        });

        delete states[chat];
    } else {
        var question = questions[Math.floor(Math.random() * questions.length)];
        gs.question = question;
        gs.hintChars = [];
        gs.numHints = 0;

        bot.sendMessage({
            text: 'Round: ' + gs.round + '/10:\nQuestion: ' + question.question,
            chat_id: chat
        });

        gs.hintTimeout = setTimeout(function() {
            sendHint(chat);
        }, hintTime);
    }
};

var stopTrivia = function(chat, from) {
    var gs = states[chat];

    if (from.id !== gs.startedBy) {
        bot.sendMessage({
            text: 'Trivia can only be stopped by whomever started it.',
            chat_id: chat
        });

        return;
    }

    clearTimeout(gs.hintTimeout);
    gs.hintTimeout = null;

    bot.sendMessage({
        text: 'Trivia stopped.',
        chat_id: chat
    });
};

var startTrivia = function(chat, from) {
    if (states[chat]) {
        bot.sendMessage({
            text: 'Trivia already started!',
            chat_id: chat
        });
        return;
    }

    states[chat] = {
        hintChars: [],
        startedBy: from.id,
        question: null,
        round: 0,
        scores: {},
        numHints: 0,
        active: false,
        hintTimeout: null
    };

    bot.sendMessage({
        text: 'Trivia started!',
        chat_id: chat
    }, function() {
        nextRound(chat);
    });
};

var verifyAnswer = function(chat, from, text) {
    var gs = states[chat];

    if (!gs.active) {
        return;
    }

    text = text.toLowerCase();
    for (var i = 0; i < gs.question.answers.length; i++) {
        var answer = gs.question.answers[i].toLowerCase();

        if (answer === text) {
            if (!gs.scores[from.id]) {
                gs.scores[from.id] = {
                    id: from.id,
                    firstName: from.first_name,
                    lastName: from.last_name,
                    score: 0
                }
            }

            gs.scores[from.id].score++;

            bot.sendMessage({
                text: 'Points to ' + from.first_name + '! "' + answer + '" is the correct answer!',
                chat_id: chat
            }, function() {
                printStandings(chat);
            });

            gs.active = false;
            setTimeout(function() {
                nextRound(chat);
            }, intermissionTime);

            break;
        }
    }
};

var token = require(process.env.HOME + '/.triviabot/token.js');
var Bot = require('node-telegram-bot');
var bot = new Bot({
    token: token
})
.on('message', function(msg) {
    if (msg.text) {
        if (!msg.text.indexOf('/trivia')) {
            startTrivia(msg.chat.id, msg.from);
        } else if (states[msg.chat.id]) {
            if (!msg.text.indexOf('/stoptrivia')) {
                stopTrivia(msg.chat.id, msg.from);
            } else {
                verifyAnswer(msg.chat.id, msg.from, msg.text);
            }
        }
    }
});

bot.start();