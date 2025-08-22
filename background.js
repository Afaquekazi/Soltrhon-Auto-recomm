chrome.action.onClicked.addListener(async (tab) => {
 try {
   await chrome.tabs.sendMessage(tab.id, { action: "toggleExtension" });
 } catch (error) {
   console.error('Error sending message:', error);
 }
});

// Helper function to get auth token
async function getAuthToken() {
  try {
    const result = await chrome.storage.local.get(['authToken']);
    return result.authToken || null;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

// Helper function to create headers with optional auth
async function createHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  
  const authToken = await getAuthToken();
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  return headers;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
 if (request.type === 'enhance_text') {
   // Determine the endpoint based on mode
   const mode = request.data.mode || 'enhance';
   let endpoint = 'generate';
   let requestBody = { ...request.data, mode: mode };
   
   // Route to persona generator endpoint if mode is persona_generator
   if (mode === 'persona_generator') {
     endpoint = 'generate-persona';
     // Map 'topic' to 'text' for persona endpoint
     requestBody = {
       text: request.data.topic,
       mode: mode
     };
   }
   
   // Create AbortController for timeout handling
   const controller = new AbortController();
   const timeoutId = setTimeout(() => {
     console.log(`Request timeout for mode: ${mode}`);
     controller.abort();
   }, mode === 'persona_generator' ? 30000 : 15000); // 30s for persona, 15s for others
   
   // Get headers with auth token
   createHeaders().then(headers => {
     fetch(`https://afaque.pythonanywhere.com/${endpoint}`, {
       method: 'POST',
       headers: headers,
       body: JSON.stringify(requestBody),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => {
       console.log(`Success for mode ${mode}:`, data.status || 'completed');
       sendResponse({success: true, data});
     })
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('API error for mode:', mode, error);
       
       // Better error handling for different scenarios
       let errorMessage = error.message;
       if (error.name === 'AbortError') {
         errorMessage = `Request timeout - ${mode === 'persona_generator' ? 'AI analysis' : 'processing'} took too long`;
       } else if (error.message.includes('Failed to fetch')) {
         errorMessage = 'Network error - please check your connection';
       }
       
       sendResponse({success: false, error: errorMessage});
     });
   });
   return true;
 }

 if (request.type === 'explain_meaning') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 15000);
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/explain-meaning', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify(request.data),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => sendResponse({success: true, data}))
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Explain meaning API error:', error);
       sendResponse({success: false, error: error.message});
     });
   });
   return true;
 }

 if (request.type === 'explain_story') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 15000);
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/explain-story', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify(request.data),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => sendResponse({success: true, data}))
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Explain story API error:', error);
       sendResponse({success: false, error: error.message});
     });
   });
   return true;
 }

 if (request.type === 'explain_eli5') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 15000);
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/explain-eli5', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify(request.data),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => sendResponse({success: true, data}))
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Explain ELI5 API error:', error);
       sendResponse({success: false, error: error.message});
     });
   });
   return true;
 }

 // Smart Followups Handler
 if (request.type === 'smart_followups') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s for followups
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/smart-followups', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify({
         conversation: request.data.conversation,
         platform: request.data.platform
       }),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => sendResponse({success: true, data}))
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Smart followups API error:', error);
       sendResponse({success: false, error: error.message});
     });
   });
   return true;
 }

 // Smart Actions Handler
 if (request.type === 'smart_actions') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s for actions
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/smart-actions', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify({
         conversation: request.data.conversation,
         platform: request.data.platform
       }),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => {
       console.log('Smart actions success:', data);
       sendResponse({success: true, data});
     })
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Smart actions API error:', error);
       
       // Better error handling for different scenarios
       let errorMessage = error.message;
       if (error.name === 'AbortError') {
         errorMessage = 'Action analysis timeout - please try again';
       } else if (error.message.includes('Failed to fetch')) {
         errorMessage = 'Network error - please check your connection';
       }
       
       sendResponse({success: false, error: errorMessage});
     });
   });
   return true;
 }

 // Smart Enhancements Handler
 if (request.type === 'smart_enhancements') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for enhancements
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/smart-enhancements', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify({
         text: request.data.text
       }),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => {
       console.log('Smart enhancements success:', data);
       sendResponse({success: true, data});
     })
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Smart enhancements API error:', error);
       
       // Better error handling for different scenarios
       let errorMessage = error.message;
       if (error.name === 'AbortError') {
         errorMessage = 'Enhancement analysis timeout - please try with shorter text';
       } else if (error.message.includes('Failed to fetch')) {
         errorMessage = 'Network error - please check your connection';
       }
       
       sendResponse({success: false, error: errorMessage});
     });
   });
   return true;
 }

// ADD THIS HANDLER TO YOUR BACKGROUND.JS FILE
// Insert this right after your smart_enhancements handler and before the image processing handler

// Magic Pill Enhancement Handler
if (request.type === 'magic_pill_enhance') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s for magic pill
  
  createHeaders().then(headers => {
    fetch('https://afaque.pythonanywhere.com/magic-pill-enhance', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        text: request.data.text,
        platform: request.data.platform
      }),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Magic pill enhancement success:', data);
      sendResponse({success: true, data});
    })
    .catch(error => {
      clearTimeout(timeoutId);
      console.error('Magic pill API error:', error);
      
      // Better error handling for different scenarios
      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = 'Magic pill enhancement timeout - please try with shorter text';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error - please check your connection';
      }
      
      sendResponse({success: false, error: errorMessage});
    });
  });
  return true;
}

// Intent Analysis Handler
if (request.type === 'analyze_user_intent') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s for intent analysis
  
  createHeaders().then(headers => {
    fetch('https://afaque.pythonanywhere.com/analyze-user-intent', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        prompts: request.data.prompts,
        sessionId: request.data.sessionId,
        platform: request.data.platform
      }),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Intent analysis success:', data);
      sendResponse({success: true, data});
    })
    .catch(error => {
      clearTimeout(timeoutId);
      console.error('Intent analysis API error:', error);
      
      // Better error handling for different scenarios
      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = 'Intent analysis timeout - please try again';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error - please check your connection';
      }
      
      sendResponse({success: false, error: errorMessage});
    });
  });
  return true;
}

// Context-Aware Magic Pill Handler
if (request.type === 'context_aware_magic_pill') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s for context-aware enhancement
  
  createHeaders().then(headers => {
    fetch('https://afaque.pythonanywhere.com/context-aware-magic-pill', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        text: request.data.text,
        isNewChat: request.data.isNewChat,
        promptType: request.data.promptType,
        userSession: request.data.userSession,
        platform: request.data.platform
      }),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Context-aware magic pill success:', data);
      sendResponse({success: true, data});
    })
    .catch(error => {
      clearTimeout(timeoutId);
      console.error('Context-aware magic pill API error:', error);
      
      // Better error handling for different scenarios
      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = 'Context-aware enhancement timeout - please try with shorter text';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error - please check your connection';
      }
      
      sendResponse({success: false, error: errorMessage});
    });
  });
  return true;
}

 // Image Processing Handler
 if (request.type === 'process_image') {
   const imageUrl = request.data.imageUrl;
   const mode = request.data.mode;
   
   // Determine endpoint based on image mode
   const endpoint = mode === 'image_caption' ? 'generate-caption' : 
                   mode === 'image_keyword' ? 'generate-keywords' : 
                   'generate-image';
   
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s for image processing
   
   fetch(imageUrl)
     .then(response => {
       if (!response.ok) {
         throw new Error(`Failed to fetch image: ${response.status}`);
       }
       return response.blob();
     })
     .then(blob => {
       const reader = new FileReader();
       reader.onloadend = () => {
         createHeaders().then(headers => {
           fetch(`https://afaque.pythonanywhere.com/${endpoint}`, {
             method: 'POST',
             headers: headers,
             body: JSON.stringify({
               image: reader.result,
               mode: mode
             }),
             signal: controller.signal
           })
           .then(response => {
             clearTimeout(timeoutId);
             if (!response.ok) {
               throw new Error(`HTTP ${response.status}: ${response.statusText}`);
             }
             return response.json();
           })
           .then(data => sendResponse({success: true, data}))
           .catch(error => {
             clearTimeout(timeoutId);
             console.error('Image processing API error:', error);
             sendResponse({success: false, error: error.message});
           });
         });
       };
       reader.onerror = () => {
         clearTimeout(timeoutId);
         console.error('FileReader error');
         sendResponse({success: false, error: 'Failed to read image file'});
       };
       reader.readAsDataURL(blob);
     })
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Image fetch error:', error);
       sendResponse({success: false, error: error.message});
     });
   return true;
 }

// Context Summary Handler
 if (request.type === 'context_summary') {
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s for context summary
   
   createHeaders().then(headers => {
     fetch('https://afaque.pythonanywhere.com/generate-context-summary', {
       method: 'POST',
       headers: headers,
       body: JSON.stringify({
         conversation: request.data.conversation,
         platform: request.data.platform
       }),
       signal: controller.signal
     })
     .then(response => {
       clearTimeout(timeoutId);
       if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
       }
       return response.json();
     })
     .then(data => {
       console.log('Context summary success:', data);
       sendResponse({success: true, data});
     })
     .catch(error => {
       clearTimeout(timeoutId);
       console.error('Context summary API error:', error);
       
       // Better error handling for different scenarios
       let errorMessage = error.message;
       if (error.name === 'AbortError') {
         errorMessage = 'Context summary timeout - please try again';
       } else if (error.message.includes('Failed to fetch')) {
         errorMessage = 'Network error - please check your connection';
       }
       
       sendResponse({success: false, error: errorMessage});
     });
   });
   return true;
 }

 // Return false for unhandled message types to prevent async response issues
 return false;

});
