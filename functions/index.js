
'use strict';

process.env.DEBUG = 'actions-on-google:*';

const Assistant = require('actions-on-google').ApiAiAssistant;
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
global.fetch = require('node-fetch');


const know = admin.database().ref('/animal-knowledge');
const graph = know.child('graph');

// API.AI Intent names
const PLAY_INTENT = 'play';
const NO_INTENT = 'discriminate-no';
const YES_INTENT = 'discriminate-yes';
const GIVEUP_INTENT = 'give-up';
const LEARN_THING_INTENT = 'learn-thing';
const LEARN_DISCRIM_INTENT = 'learn-discrimination';

// Contexts
const WELCOME_CONTEXT = 'welcome';
const QUESTION_CONTEXT = 'question';
const GUESS_CONTEXT = 'guess';
const LEARN_THING_CONTEXT = 'learn-thing';
const LEARN_DISCRIM_CONTEXT = 'learn-discrimination';
const ANSWER_CONTEXT = 'answer';

// Context Parameters
const CRYPTO_COIN = 'crypto-coin';
const CURRENCY_NAME = 'currency-name';
const LEARN_THING_PARAM = 'learn-thing';
const GUESSABLE_THING_PARAM = 'guessable-thing';
const LEARN_DISCRIMINATION_PARAM = 'learn-discrimination';
const ANSWER_PARAM = 'answer';
const QUESTION_PARAM = 'question';

const coinFullName = {
  ETH: 'Ethereum',
  Ethereum: 'Ethereum',
  BTC: 'Bitcoin',
  Bitcoin: 'Bitcoin',
  SC: 'Siacoin',
  Siacion: 'Siacoin'
};

exports.assistantcodelab = functions.https.onRequest((request, response) => {
   console.log('headers: ' + JSON.stringify(request.headers));
   console.log('body: ' + JSON.stringify(request.body));

   const assistant = new Assistant({request: request, response: response});

   let actionMap = new Map();
   actionMap.set(PLAY_INTENT, play);
   actionMap.set(NO_INTENT, discriminate);
   actionMap.set(YES_INTENT, discriminate);
   actionMap.set(GIVEUP_INTENT, giveUp);
   actionMap.set(LEARN_THING_INTENT, learnThing);
   actionMap.set(LEARN_DISCRIM_INTENT, learnDiscrimination);
   assistant.handleRequest(actionMap);

   function fetchJSON(url) {
     return fetch(url)
       .then(res => res.json())
       .then(body => {
         console.log(body.USD);
         if (body.Response === 'Error') throw body.Message;
         return body;
       });
   }

   function price(fsym, tsyms, options) {
     options = options || {};
     const baseUrl = 'https://min-api.cryptocompare.com/data/';
     let url = `${baseUrl}price?fsym=${fsym}&tsyms=${tsyms}`;
    //  if (options.exchanges) url += `&e=${options.exchanges}`;
    //  if (options.tryConversion === false) url += '&tryConversion=false';
     return fetchJSON(url);
   }

   function play(assistant) {
     let fsym = assistant.getArgument(CRYPTO_COIN);
     let tsyms = assistant.getArgument(CURRENCY_NAME) || 'USD';

     let getPrice = price(fsym, tsyms)
     .then((body) => body[tsyms])
     .then(prices => {
       if (fsym === 'ETH') {
         fsym = 'Ethereum';
       }
       if (fsym === 'BTC') {
         fsym = 'Bitcoin';
       }
       if (tsyms === 'USD') {
         tsyms = 'US dollars'
       }
       if (tsyms === 'EUR') {
         tsyms = 'Euros'
       }
       return `The current price of ${fsym} is $${prices} ${tsyms}`})
     .then(message => assistant.tell(message))
     .catch(console.error);
   }

   function discriminate(assistant) {
       const priorQuestion = assistant.getContextArgument(QUESTION_CONTEXT, ID_PARAM).value;

       const intent = assistant.getIntent();
       let yes_no;
       if (YES_INTENT === intent) {
           yes_no = 'y';
       } else {
           yes_no = 'n';
       }

       console.log(`prior question: ${priorQuestion}`);

       graph.child(priorQuestion).once('value', snap => {
           const next = snap.val()[yes_no];
           graph.child(next).once('value', snap => {
               const node = snap.val();
               if (node.q) {
                   const speech = node.q;

                   const parameters = {};
                   parameters[ID_PARAM] = snap.key;
                   assistant.setContext(QUESTION_CONTEXT, 5, parameters);
                   assistant.ask(speech);
               } else {
                   const guess = node.a;
                   const speech = `Is it a ${guess}?`;

                   const parameters = {};
                   parameters[ID_PARAM] = snap.key;
                   parameters[BRANCH_PARAM] = yes_no;
                   assistant.setContext(GUESS_CONTEXT, 5, parameters);
                   assistant.ask(speech);
               }
           });
       });
   }

   function giveUp(assistant) {
       const priorQuestion = assistant.getContextArgument(QUESTION_CONTEXT, ID_PARAM).value;
       const guess = assistant.getContextArgument(GUESS_CONTEXT, ID_PARAM).value;
       console.log(`Priorq: ${priorQuestion}, guess: ${guess}`);

       const speech = 'I give up!  What are you thinking of?';

       const parameters = {};
       parameters[LEARN_THING_PARAM] = true;
       assistant.setContext(LEARN_THING_CONTEXT, 2, parameters);
       assistant.ask(speech);
   }

   function learnThing(assistant) {
       const priorQuestion = assistant.getContextArgument(QUESTION_CONTEXT, ID_PARAM).value;
       const guess = assistant.getContextArgument(GUESS_CONTEXT, ID_PARAM).value;
       const branch = assistant.getContextArgument(GUESS_CONTEXT, BRANCH_PARAM).value;
       const new_thing = assistant.getArgument(GUESSABLE_THING_PARAM);

       console.log(`Priorq: ${priorQuestion}, guess: ${guess}, branch: ${branch}, thing: ${new_thing}`);

       const q_promise = graph.child(priorQuestion).once('value');
       const g_promise = graph.child(guess).once('value');
       Promise.all([q_promise, g_promise]).then(results => {
           const q_snap = results[0];
           const g_snap = results[1];

           // TODO codelab-1: set the proper contexts to learn the differentiation
          const speech = `
          I need to know how to tell a ${new_thing} from a ${g_snap.val().a} using a yes-no question.
          The answer must be "yes" for ${new_thing}. What question should I use?
          `;

          const discrmParameters = {};
          discrmParameters[LEARN_DISCRIMINATION_PARAM] = true;
          assistant.setContext(LEARN_DISCRIM_CONTEXT, 2, discrmParameters);

          const answerParameters = {};
          answerParameters[ANSWER_PARAM] = new_thing;
          assistant.setContext(ANSWER_CONTEXT, 2, answerParameters);

          assistant.ask(speech);
       });
   }

   function learnDiscrimination(assistant) {
       const priorQuestion = assistant.getContextArgument(QUESTION_CONTEXT, ID_PARAM).value;
       const guess = assistant.getContextArgument(GUESS_CONTEXT, ID_PARAM).value;
       const branch = assistant.getContextArgument(GUESS_CONTEXT, BRANCH_PARAM).value;
       const answer =  assistant.getContextArgument(ANSWER_CONTEXT, ANSWER_PARAM).value;
       const question = assistant.getArgument(QUESTION_PARAM);

       console.log(`Priorq: ${priorQuestion}, answer: ${answer}, guess: ${guess}, branch: ${branch}, question: ${question}`);

       const a_node = graph.push({
           a: answer
       });

       const q_node = graph.push({
           q: `${question}?`,
           y: a_node.key,
           n: guess
       });

       let predicate = 'a';
       if (['a','e','i','o','u'].indexOf(answer.charAt(0)) != -1) {
           predicate = 'an';
       }

       const update = {};
       update[branch] = q_node.key;
       graph.child(priorQuestion).update(update).then(() => {
          const speech = `<speak>
          OK, thanks for the information! I'll remember to ask "${question}" to see if you're thinking of ${predicate} ${answer}.
          <break time="1">
          Would you like to play again?
          </speak>
          `;
          assistant.setContext(WELCOME_CONTEXT, 1);
       });
   }
});