import {analyzeBook} from './book-study.js';
self.onmessage=event=>{try{self.postMessage({study:analyzeBook(event.data)})}catch(error){self.postMessage({error:error.message})}};
