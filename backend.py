from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
import logging
import os
import json
import requests  # ADD THIS LINE
import hashlib
import base64
import json


# NEW FIREBASE IMPORTS
import firebase_admin
from firebase_admin import credentials, firestore, auth
import jwt
import datetime
from functools import wraps

app = Flask(__name__)

# FIXED: Single CORS configuration (no duplicates)
CORS(app,
     origins=['*'],
     allow_headers=['Content-Type', 'Authorization'],
     methods=['GET', 'POST', 'OPTIONS'],
     supports_credentials=False)

# REMOVED: @app.after_request and @app.before_request functions (were causing duplicate headers)

logging.basicConfig(level=logging.INFO)
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
client = OpenAI(api_key=OPENAI_API_KEY)

# MAILGUN CONFIGURATION - ADD THIS ENTIRE SECTION
MAILGUN_API_KEY = os.getenv('MAILGUN_API_KEY', '')
MAILGUN_DOMAIN = os.getenv('MAILGUN_DOMAIN', 'mg.solthron.com')
MAILGUN_BASE_URL = os.getenv('MAILGUN_BASE_URL', 'https://api.mailgun.net/v3')
FRONTEND_BASE_URL = os.getenv('FRONTEND_BASE_URL', 'https://solthron.com')
VERIFICATION_BASE_URL = os.getenv('VERIFICATION_BASE_URL', 'https://afaque.pythonanywhere.com')

print(f"🔑 Mailgun API key loaded: {'✅' if MAILGUN_API_KEY else '❌'}")
print(f"🌐 Mailgun domain: {MAILGUN_DOMAIN}")

# FIREBASE ADMIN SDK INITIALIZATION
try:
    # Initialize Firebase Admin SDK
    cred = credentials.Certificate('/home/Afaque/mysite/firebase-service-account.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    FIREBASE_ENABLED = True
    print("✅ Firebase Admin SDK initialized successfully")

except Exception as e:
    print(f"❌ Firebase initialization failed: {e}")
    FIREBASE_ENABLED = False

# CREDIT MAPPING FUNCTION (matches your extension logic exactly)
def get_feature_credits(mode):
    """Map features to credit costs - matches extension logic exactly"""

    # Text Processing: 6 credits
    text_processing_modes = [
        'reframe_casual', 'reframe_technical', 'reframe_professional',
        'reframe_eli5', 'reframe_short', 'reframe_long'
    ]

    # Convert Prompts: 8 credits
    convert_prompt_modes = [
        'convert_concise', 'convert_balanced', 'convert_detailed'
    ]

    # Persona AI Generator: 10 credits
    persona_modes = ['persona_generator']

    # Image Processing: 12 credits
    image_modes = ['image_prompt', 'image_caption']

    # Explain: 5 credits
    explain_modes = ['explain_meaning', 'explain_story', 'explain_eli5']

    # AI Assistant: 15 credits
    ai_assistant_modes = ['smart_followups', 'smart_actions', 'smart_enhancements']

    # Free Features: 0 credits
    free_modes = ['save_note', 'save_prompt', 'save_persona']

    # Determine credit cost based on mode
    if mode in text_processing_modes:
        return 6
    elif mode in convert_prompt_modes:
        return 8
    elif mode in persona_modes:
        return 10
    elif mode in image_modes:
        return 12
    elif mode in explain_modes:
        return 5
    elif mode in ai_assistant_modes:
        return 15
    elif mode in free_modes:
        return 0
    else:
        return 6  # Default fallback

# AUTHENTICATION HELPER FUNCTIONS
def verify_auth_token(token):
    """Verify JWT token and return user info"""
    if not FIREBASE_ENABLED:
        return None

    try:
        # Decode JWT token
        payload = jwt.decode(token, options={"verify_signature": False})
        user_id = payload.get('uid') or payload.get('user_id')

        if not user_id:
            return None

        # Get user from Firebase
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()

        if user_doc.exists:
            return {
                'uid': user_id,
                'data': user_doc.to_dict()
            }
        return None

    except Exception as e:
        print(f"Token verification failed: {e}")
        return None

def check_and_deduct_credits(user_uid, feature_mode):
    """Check if user has enough credits and deduct them"""
    if not FIREBASE_ENABLED:
        return {'success': True, 'message': 'Firebase disabled - allowing free usage'}

    try:
        required_credits = get_feature_credits(feature_mode)

        # Free features don't need credit checks
        if required_credits == 0:
            return {'success': True, 'credits_used': 0}

        # Get user document
        user_ref = db.collection('users').document(user_uid)

        # Use Firestore transaction for atomic credit deduction
        @firestore.transactional
        def update_credits(transaction):
            user_doc = user_ref.get(transaction=transaction)

            if not user_doc.exists:
                return {'success': False, 'message': 'User not found'}

            user_data = user_doc.to_dict()
            current_credits = user_data.get('credits', 0)

            if current_credits < required_credits:
                return {
                    'success': False,
                    'message': f'Insufficient credits. Need {required_credits}, have {current_credits}',
                    'current_credits': current_credits
                }

            # Deduct credits
            new_credits = current_credits - required_credits
            transaction.update(user_ref, {
                'credits': new_credits,
                'lastUpdated': firestore.SERVER_TIMESTAMP
            })

            # Log transaction
            transaction_ref = db.collection('transactions').document()
            transaction.set(transaction_ref, {
                'userId': user_uid,
                'feature': feature_mode,
                'creditsUsed': required_credits,
                'timestamp': firestore.SERVER_TIMESTAMP,
                'creditsRemaining': new_credits
            })

            return {
                'success': True,
                'credits_used': required_credits,
                'remaining': new_credits
            }

        # Execute transaction
        transaction = db.transaction()
        result = update_credits(transaction)
        return result

    except Exception as e:
        print(f"Credit deduction error: {e}")
        return {'success': False, 'message': str(e)}

def optional_credit_check(feature_mode):
    """Optional credit check that doesn't break existing functionality"""
    try:
        # Check if user sent auth token
        auth_header = request.headers.get('Authorization')

        # If no auth token, allow free usage (backwards compatibility)
        if not auth_header or not auth_header.startswith('Bearer '):
            return {'success': False, 'message': 'Authentication required'}

        # If auth token provided, verify and check credits
        token = auth_header[7:]
        user_info = verify_auth_token(token)

        if not user_info:
            return {'success': True, 'message': 'Invalid token - allowing free usage'}

        # Check and deduct credits
        result = check_and_deduct_credits(user_info['uid'], feature_mode)
        return result

    except Exception as e:
        # On any error, allow free usage (safety fallback)
        print(f"Credit check error: {e}")
        return {'success': True, 'message': 'Credit check failed - allowing free usage'}


# ============================================
# MAILGUN EMAIL FUNCTIONS - ADD THIS SECTION
# ============================================

def generate_verification_token_v2(email):
    """Generate a verification token with embedded expiration - RELIABLE VERSION"""
    try:
        # Create expiration time (24 hours from now)
        expiration = datetime.datetime.utcnow() + datetime.timedelta(hours=24)

        # Create token data
        token_data = {
            'email': email,
            'expires': expiration.isoformat(),
            'created': datetime.datetime.utcnow().isoformat(),
            'secret': MAILGUN_API_KEY[:16] if MAILGUN_API_KEY else "fallback_key"
        }

        # Encode to JSON then base64
        json_str = json.dumps(token_data)
        token_bytes = json_str.encode('utf-8')
        token_b64 = base64.urlsafe_b64encode(token_bytes).decode('utf-8')

        # Create hash for verification
        final_string = f"{token_b64}:{MAILGUN_API_KEY}"
        token_hash = hashlib.sha256(final_string.encode()).hexdigest()[:16]

        # Combine base64 data with hash
        final_token = f"{token_b64}.{token_hash}"

        print(f"🔧 DEBUG: Token generated successfully for {email}")
        return final_token

    except Exception as e:
        print(f"❌ Token generation failed: {e}")
        return None

def verify_token_v2(email, token):
    """Verify token with embedded expiration - RELIABLE VERSION"""
    try:
        if not MAILGUN_API_KEY:
            print(f"❌ Token verification failed: No API key")
            return False

        if not token or '.' not in token:
            print(f"❌ Invalid token format: {token}")
            return False

        # Split token into data and hash parts
        try:
            token_b64, token_hash = token.rsplit('.', 1)
        except ValueError:
            print(f"❌ Could not split token")
            return False

        # Verify hash first
        expected_hash = hashlib.sha256(f"{token_b64}:{MAILGUN_API_KEY}".encode()).hexdigest()[:16]
        if expected_hash != token_hash:
            print(f"❌ Token hash verification failed")
            return False

        # Decode token data
        try:
            token_bytes = base64.urlsafe_b64decode(token_b64.encode('utf-8'))
            token_json = token_bytes.decode('utf-8')
            token_data = json.loads(token_json)
        except Exception as decode_error:
            print(f"❌ Token decode error: {decode_error}")
            return False

        # Verify email matches
        if token_data.get('email') != email:
            print(f"❌ Email mismatch in token")
            return False

        # Check expiration
        try:
            expiration = datetime.datetime.fromisoformat(token_data['expires'])
            current_time = datetime.datetime.utcnow()

            if current_time > expiration:
                print(f"❌ Token has expired")
                return False

            print(f"✅ Token verified successfully for {email}")
            return True

        except Exception as time_error:
            print(f"❌ Time parsing error: {time_error}")
            return False

    except Exception as e:
        print(f"❌ Token verification error: {e}")
        return False

def send_verification_email_mailgun(email, first_name=""):
    """Send verification email using Mailgun - IMPROVED VERSION WITH DEBUGGING"""
    try:
        print(f"🔧 DEBUG: === Starting email send process ===")
        print(f"🔧 DEBUG: Email: {email}")
        print(f"🔧 DEBUG: First name: {first_name}")

        # Step 1: Validate environment variables
        if not MAILGUN_API_KEY:
            print(f"❌ DEBUG: MAILGUN_API_KEY is missing or empty")
            return {"success": False, "message": "Mailgun API key not configured"}

        if not MAILGUN_DOMAIN:
            print(f"❌ DEBUG: MAILGUN_DOMAIN is missing or empty")
            return {"success": False, "message": "Mailgun domain not configured"}

        print(f"✅ DEBUG: Environment variables present")
        print(f"🔧 DEBUG: API Key length: {len(MAILGUN_API_KEY)}")
        print(f"🔧 DEBUG: Domain: {MAILGUN_DOMAIN}")
        print(f"🔧 DEBUG: Base URL: {MAILGUN_BASE_URL}")

        # Step 2: Generate verification token
        print(f"🔧 DEBUG: Generating verification token...")
        verification_token = generate_verification_token_v2(email)
        if not verification_token:
            print(f"❌ DEBUG: Token generation failed")
            return {"success": False, "message": "Failed to generate verification token"}

        print(f"✅ DEBUG: Token generated successfully")

        # Step 3: Build verification URL
        verification_url = f"{VERIFICATION_BASE_URL}/verify-email?email={email}&token={verification_token}"
        print(f"🔧 DEBUG: Verification URL: {verification_url}")

        # Step 4: Prepare email content
        print(f"🔧 DEBUG: Preparing email content...")

        # Simplified welcome text to avoid f-string issues
        if first_name:
            welcome_text = f"Welcome {first_name}!"
        else:
            welcome_text = "Welcome!"

        print(f"🔧 DEBUG: Welcome text: {welcome_text}")

        # Professional HTML Email Template (simplified to avoid f-string errors)
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Solthron Account</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px;">
        <!-- Header -->
        <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #ffff00;">
            <h1 style="color: #333; margin: 0; font-size: 28px;">
                <span style="color: #ffff00;">⚡</span> Solthron
            </h1>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">
                Stop Overthinking AI Conversations
            </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
            <h2 style="color: #333; margin-bottom: 20px;">{welcome_text} 🚀</h2>

            <p style="color: #555; line-height: 1.6; font-size: 16px;">
                Thanks for signing up for Solthron! You're one step away from supercharging your AI conversations.
            </p>

            <p style="color: #555; line-height: 1.6; font-size: 16px;">
                Click the button below to verify your email address and start optimizing your prompts:
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 30px 0;">
                <a href="{verification_url}"
                   style="background-color: #ffff00; color: #000; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block; border: 2px solid #ffff00;">
                    Verify Email Address ✅
                </a>
            </div>

            <p style="color: #777; font-size: 14px; line-height: 1.5;">
                If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="background-color: #f8f8f8; padding: 10px; border-radius: 4px; word-break: break-all; font-size: 12px; color: #555;">
                {verification_url}
            </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8f8f8; padding: 20px; text-align: center; border-top: 1px solid #eee;">
            <p style="margin: 0; color: #666; font-size: 14px;">
                This verification link expires in 24 hours.
            </p>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 12px;">
                © 2025 Solthron. Made for better AI conversations.
            </p>
        </div>
    </div>
</body>
</html>"""

        # Plain text fallback
        text_content = f"""
{welcome_text}

Thanks for signing up! Click the link below to verify your email address:

{verification_url}

This link expires in 24 hours.

Once verified, you can start optimizing your AI conversations with our Chrome extension.

- Solthron Team
"""

        print(f"✅ DEBUG: Email content prepared")

        # Step 5: Prepare Mailgun request
        mailgun_url = f"{MAILGUN_BASE_URL}/{MAILGUN_DOMAIN}/messages"
        print(f"🔧 DEBUG: Mailgun URL: {mailgun_url}")

        email_data = {
            "from": f"Solthron <noreply@{MAILGUN_DOMAIN}>",
            "to": [email],
            "subject": "🚀 Verify Your Solthron Account - Start Optimizing AI Conversations",
            "text": text_content,
            "html": html_content,
            "o:tag": ["verification", "signup"],
            "o:tracking": "yes"
        }

        print(f"🔧 DEBUG: Email data prepared")
        print(f"🔧 DEBUG: From: {email_data['from']}")
        print(f"🔧 DEBUG: To: {email_data['to']}")
        print(f"🔧 DEBUG: Subject: {email_data['subject']}")

        # Step 6: Send email via Mailgun
        print(f"🔧 DEBUG: Sending request to Mailgun...")

        response = requests.post(
            mailgun_url,
            auth=("api", MAILGUN_API_KEY),
            data=email_data,
            timeout=30  # Add timeout
        )

        print(f"🔧 DEBUG: Mailgun response status: {response.status_code}")
        print(f"🔧 DEBUG: Mailgun response text: {response.text}")

        if response.status_code == 200:
            print(f"✅ Verification email sent successfully to {email}")
            return {"success": True, "message": "Verification email sent"}
        else:
            print(f"❌ Mailgun error: {response.status_code} - {response.text}")
            return {"success": False, "message": f"Mailgun API error: {response.status_code}"}

    except requests.exceptions.Timeout:
        print(f"❌ Mailgun request timeout")
        return {"success": False, "message": "Email service timeout"}
    except requests.exceptions.ConnectionError:
        print(f"❌ Mailgun connection error")
        return {"success": False, "message": "Failed to connect to email service"}
    except requests.exceptions.RequestException as e:
        print(f"❌ Mailgun request error: {e}")
        return {"success": False, "message": f"Email service error: {str(e)}"}
    except Exception as e:
        print(f"❌ Unexpected error in send_verification_email_mailgun: {e}")
        print(f"❌ Error type: {type(e).__name__}")

# ============================================
# END MAILGUN EMAIL FUNCTIONS
# ============================================

# NEW AUTHENTICATION ENDPOINTS
@app.route('/auth/login', methods=['POST'])
def auth_login():
    """Handle login and return JWT token"""
    try:
        if not FIREBASE_ENABLED:
            return jsonify({'error': 'Authentication not available'}), 503

        data = request.get_json()
        email = data.get('email')
        password = data.get('password')

        if not email or not password:
            return jsonify({'error': 'Email and password required'}), 400

        # Check if user exists in Firestore
        users_ref = db.collection('users')
        query = users_ref.where('email', '==', email).limit(1)
        users = query.stream()

        user_doc = None
        for user in users:
            user_doc = user
            break

        if not user_doc:
            return jsonify({'error': 'User not found'}), 401

        user_data = user_doc.to_dict()

        # Create JWT token
        token_payload = {
            'uid': user_doc.id,
            'email': email,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=30)
        }

        token = jwt.encode(token_payload, 'your-secret-key', algorithm='HS256')

        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'uid': user_doc.id,
                'email': email,
                'credits': user_data.get('credits', 0)
            }
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/user-credits', methods=['GET'])
def get_user_credits():
    """Get user's current credit balance"""
    try:
        if not FIREBASE_ENABLED:
            return jsonify({'credits': 999999})  # Unlimited for testing

        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'No valid authorization token'}), 401

        token = auth_header[7:]  # Remove 'Bearer '
        user_info = verify_auth_token(token)

        if not user_info:
            return jsonify({'error': 'Invalid token'}), 401

        credits = user_info['data'].get('credits', 0)
        return jsonify({'credits': credits})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/deduct-credits', methods=['POST'])
def deduct_credits():
    """Deduct credits for a feature"""
    try:
        if not FIREBASE_ENABLED:
            return jsonify({'success': True, 'remaining': 999999})

        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'No valid authorization token'}), 401

        token = auth_header[7:]
        user_info = verify_auth_token(token)

        if not user_info:
            return jsonify({'error': 'Invalid token'}), 401

        data = request.get_json()
        feature_mode = data.get('feature', 'unknown')

        result = check_and_deduct_credits(user_info['uid'], feature_mode)
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# YOUR EXISTING AI PROCESSING FUNCTIONS (keeping them exactly the same)
def create_enhanced_rewrite(topic, tone, length, mode='enhance'):
    if mode == 'cot':
        fixed_template = f"""Original User Request:
{topic}

INITIATING CHAIN OF THOUGHT ANALYSIS...

LAYER 1: CORE DECONSTRUCTION
→ What is the fundamental purpose behind this task?
→ What unstated requirements might exist?
→ What potential angles are being overlooked?
→ What unique value can be uncovered?

LAYER 2: EXPANSION OF POSSIBILITIES
Branch A: Conventional Path
   → Standard approach analysis
   → Expected outcomes
   → Limitations identified

Branch B: Innovation Path
   → Unconventional angles
   → Creative possibilities
   → Breakthrough potential

Branch C: Hybrid Solutions
   → Best elements fusion
   → Enhanced approaches
   → Optimal combinations

LAYER 3: DEPTH EXPLORATION
1. Knowledge Mining
   → Core principles
   → Hidden connections
   → Advanced concepts
   → Expert insights

2. Pattern Recognition
   → Success elements
   → Failure points
   → Optimization opportunities
   → Strategic advantages

3. Impact Analysis
   → Immediate effects
   → Long-term implications
   → Ripple consequences
   → Value maximization

LAYER 4: SYNTHESIS & ELEVATION
• Merge all insights into cohesive strategy
• Identify breakthrough opportunities
• Eliminate potential weaknesses
• Enhance core strengths
• Push beyond obvious solutions

EXECUTION FRAMEWORK:
1. Foundation Building
   → Establish core elements
   → Set up key structures
   → Create support systems

2. Enhancement Integration
   → Add innovative elements
   → Incorporate unique angles
   → Blend creative solutions

3. Excellence Amplification
   → Optimize all components
   → Maximize impact points
   → Elevate quality levels

FINAL ACCELERATION:
→ Challenge every assumption
→ Push every boundary
→ Exceed all expectations
→ Transform basic into exceptional
→ Elevate ordinary to extraordinary

Now, armed with this comprehensive analytical framework, return to:
{topic}

EXECUTE WITH MAXIMUM CAPABILITY AND CREATIVITY.
Transform this task beyond its basic form into something extraordinary.
Push every boundary. Challenge every norm. Create something remarkable.

[Proceed with execution using all layers of analysis above]"""

        return {
            "prompt": fixed_template,
            "status": "success",
            "metadata": {
                "topic": topic,
                "tone": tone,
                "mode": "cot"
            }
        }

    else:
        system_message = """You are an expert at reframing text to make it clear, concise, and actionable.
[System message content...]"""  # System message content as before

        detail_mapping = {
            "concise": """[Concise template content...]""",
            "balanced": """[Balanced template content...]""",
            "detailed": """[Detailed template content...]"""
        }

        user_message = detail_mapping.get(length, detail_mapping["balanced"]).format(
            topic=topic, tone=tone
        )

        return {
            "system_message": system_message,
            "user_message": user_message
        }

def process_reframe_request(client, topic, tone, length):
    if tone.startswith('reframe_'):
        tone = tone.split('_')[1]

    template = create_tone_specific_prompt(topic, tone, length)
    if not template:
        raise ValueError(f"Unsupported tone: {tone}")

    response = client.chat.completions.create(
        model="chatgpt-4o-latest",
        messages=[
            {"role": "system", "content": template["system"]},
            {"role": "user", "content": template["user"]},
            {"role": "system", "content": "Important: Output must match requested format exactly."}
        ],
        temperature=0.3
    )

    return {
        'prompt': response.choices[0].message.content,
        'status': 'success',
        'metadata': {
            'topic': topic,
            'tone': tone,
            'mode': f'reframe_{tone}'
        }
    }

def create_tone_specific_prompt(topic, tone, length):
    tone_templates = {
        "casual": {
            "system": "Your only task is to transform the text into simple tone, only tranform/rephrase, ONLY rewrite the exact same content, dont answer it as a question, If the text is a question, keep it as a question but make it simple",
            "user": f"Make this casual and friendly:\n{topic}"
        },
        "technical": {
            "system": "Your only task is to Transform text into technical tone,only tranform/rephrase, ONLY rewrite the exact same content, dont answer it as a question, even if the highlighted text is a question, keep it as a question but make it simple ",
            "user": f"Make this technical:\n{topic}"
        },
        "professional": {
            "system": "Transform text into professional tone, only tranform/rephrase, dont answer it as a question, even if the highlighted text is a question, you will only reframe it",
            "user": f"Make this professional:\n{topic}"
        },
        "eli5": {
            "system": "Transform text for a 5-year-old understanding, only tranform/rephrase, dont answer it as a question, even if the highlighted text is a question, you will only reframe it",
            "user": f"Rewrite this for a 5-year-old:\n{topic}"
        },
        "short": {
            "system": "Make text shorter while keeping main points, only make it short, dont answer it as a question, even if the highlighted text is a question, you will only reframe it",
            "user": f"Make this shorter but keep key points:\n{topic}"
        },
        "long": {
            "system": "Expand text with more details, only make it long by adding 2 to 3 lines more and dont answer it as a question, even if the highlighted text is a question, you will only reframe it",
            "user": f"Make this longer and more detailed:\n{topic}"
        }
    }
    return tone_templates.get(tone)

def create_explain_prompt(topic, mode):
    explain_templates = {
        "explain_meaning": {
            "system": """Provide clear, direct explanations of meanings. Guidelines:
- Give straightforward definitions
- Explain key concepts clearly
- Use simple language
- Keep output balanced in length (2-3 short paragraphs)
- No markdown, bullets, or special formatting""",
            "user": f"What does this mean:\n{topic}"
        },
        "explain_example": {
            "system": """Explain concepts through clear examples. Guidelines:
- Use one clear, relevant example
- Connect example to the concept
- Keep explanation practical
- Maintain balanced length (2-3 short paragraphs)
- No markdown, bullets, or special formatting""",
            "user": f"Provide an example that explains:\n{topic}"
        },
        "explain_eli5": {
            "system": """Explain concepts in child-friendly terms. Guidelines:
- Use very simple words
- Give relatable examples
- Keep sentences short
- Maintain balanced length (2-3 short paragraphs)
- No markdown, bullets, or special formatting""",
            "user": f"Explain this to a young child:\n{topic}"
        }
    }
    return explain_templates.get(mode)

def process_image_variation(client, image_data, mode):
    image_templates = {
        "image_caption": {
            "system": "Generate a concise, descriptive caption for this image.",
            "max_tokens": 50
        },
        "image_prompt": {
            "system": "Generate a detailed prompt that describes this image for AI image generation.",
            "max_tokens": 100
        }
    }

    template = image_templates.get(mode, {
        "system": "Default image processing system message",
        "max_tokens": 50
    })

    response = client.chat.completions.create(
        model="chatgpt-4o-latest",
        messages=[
            {"role": "system", "content": template["system"]},
            {"role": "user", "content": [
                {"type": "text", "text": "Process this image:"},
                {"type": "image_url", "image_url": {"url": image_data}}
            ]}
        ],
        max_tokens=template["max_tokens"]
    )

    return {
        'prompt': response.choices[0].message.content,
        'status': 'success',
        'metadata': {'mode': mode}
    }

def extract_questions_from_text(text):
    """Extract questions from AI response when JSON parsing fails"""
    questions = []
    lines = text.split('\n')

    for line in lines:
        line = line.strip()
        if '?' in line and len(line) > 20:
            # Clean the question
            clean_q = line

            # Remove common prefixes and artifacts
            prefixes = ['"text":', 'text:', '"', "'", '-', '•', '*', '1.', '2.', '3.', '4.', '5.']
            for prefix in prefixes:
                if clean_q.startswith(prefix):
                    clean_q = clean_q[len(prefix):].strip()

            # Remove trailing punctuation except ?
            clean_q = clean_q.rstrip('",\'"').strip()

            # Ensure it looks like a question
            if clean_q and clean_q.endswith('?') and len(clean_q) > 15:
                questions.append({
                    "text": clean_q,
                    "type": "strategic"
                })

    # If no questions extracted, provide high-quality defaults
    if len(questions) == 0:
        questions = [
            {"text": "What underlying assumptions in this approach should be validated or challenged?", "type": "assumption"},
            {"text": "What alternative strategies or methodologies could achieve similar outcomes?", "type": "alternative"},
            {"text": "What would be the key implementation challenges and success factors?", "type": "implementation"}
        ]

    return questions[:3]

def parse_json_response_enhanced(ai_response):
    """Enhanced JSON parsing for GPT-4.1's higher quality output"""

    # GPT-4.1 should produce cleaner JSON, but still handle edge cases
    clean_response = ai_response.strip()

    # Remove markdown code blocks if present
    if "```json" in clean_response:
        clean_response = clean_response.split("```json")[1].split("```")[0].strip()
    elif "```" in clean_response:
        parts = clean_response.split("```")
        if len(parts) >= 3:
            clean_response = parts[1].strip()

    # Find JSON object boundaries
    start_idx = clean_response.find('{')
    if start_idx == -1:
        raise json.JSONDecodeError("No JSON found", clean_response, 0)

    # Find the matching closing brace
    brace_count = 0
    end_idx = -1
    in_string = False
    escape_next = False

    for i in range(start_idx, len(clean_response)):
        char = clean_response[i]

        if escape_next:
            escape_next = False
            continue

        if char == '\\' and in_string:
            escape_next = True
            continue

        if char == '"':
            in_string = not in_string
            continue

        if not in_string:
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    end_idx = i + 1
                    break

    if end_idx == -1:
        raise json.JSONDecodeError("Incomplete JSON", clean_response, start_idx)

    json_str = clean_response[start_idx:end_idx]
    return json.loads(json_str)

def create_gpt41_fallback_prompts_clean(original_text):
    """Create high-quality fallback prompts WITHOUT including the original text"""

    # Analyze text type for better fallbacks
    text_lower = original_text.lower()

    if any(keyword in text_lower for keyword in ['function', 'class', 'def', 'var', 'const', 'import']):
        content_type = "code"
    elif any(keyword in text_lower for keyword in ['write', 'blog', 'article', 'content', 'copy']):
        content_type = "writing"
    elif original_text.endswith('?') or 'help' in text_lower:
        content_type = "prompt"
    else:
        content_type = "content"

    fallback_prompts = [
        {
            "prompt": f"Enhance this {content_type} by making it more precise, detailed, and actionable with specific examples and clear structure",
            "focus_area": "precision_and_clarity",
            "expected_impact": "Improved clarity and specificity",
            "priority": "high"
        },
        {
            "prompt": f"Improve this {content_type} by adding context, supporting details, and better organization to increase engagement",
            "focus_area": "depth_and_structure",
            "expected_impact": "Enhanced depth and organization",
            "priority": "high"
        },
        {
            "prompt": f"Refine this {content_type} to be more engaging and persuasive with stronger language and compelling elements",
            "focus_area": "engagement",
            "expected_impact": "Increased engagement and persuasion",
            "priority": "medium"
        },
        {
            "prompt": f"Optimize this {content_type} for professional quality by following best practices and ensuring completeness",
            "focus_area": "professional_quality",
            "expected_impact": "Professional-grade output",
            "priority": "medium"
        }
    ]

    return fallback_prompts

def extract_suggestions_from_text_enhanced(text):
    """Extract enhancement suggestions from AI response when JSON parsing fails"""
    suggestions = []
    lines = text.split('\n')

    for line in lines:
        line = line.strip()
        if any(starter in line.lower() for starter in ['enhance', 'improve', 'refine', 'optimize', 'add', 'include']):
            if len(line) > 30 and len(line) < 300:
                # Clean the suggestion
                clean_suggestion = line

                # Remove common prefixes
                prefixes = ['"prompt":', 'prompt:', '"', "'", '-', '•', '*', '1.', '2.', '3.', '4.', '5.']
                for prefix in prefixes:
                    if clean_suggestion.startswith(prefix):
                        clean_suggestion = clean_suggestion[len(prefix):].strip()

                # Remove trailing punctuation
                clean_suggestion = clean_suggestion.rstrip('",\'"').strip()

                if clean_suggestion and len(clean_suggestion) > 20:
                    suggestions.append({
                        "prompt": clean_suggestion,
                        "focus_area": "improvement",
                        "expected_impact": "Enhanced quality",
                        "priority": "medium"
                    })

    # If no suggestions extracted, provide defaults
    if len(suggestions) == 0:
        suggestions = [
            {"prompt": "Enhance this content by making it more specific and detailed", "focus_area": "specificity", "expected_impact": "Better clarity", "priority": "high"},
            {"prompt": "Improve this content by adding more context and examples", "focus_area": "context", "expected_impact": "Better understanding", "priority": "high"},
            {"prompt": "Refine this content to be more engaging and actionable", "focus_area": "engagement", "expected_impact": "Better user experience", "priority": "medium"},
            {"prompt": "Optimize this content for better structure and flow", "focus_area": "structure", "expected_impact": "Better organization", "priority": "medium"}
        ]

    return suggestions[:4]

# DEBUG ENDPOINTS
@app.route('/debug-routes', methods=['GET'])
def debug_routes():
    """Debug endpoint to check which routes are loaded"""
    routes = []
    for rule in app.url_map.iter_rules():
        routes.append({
            'endpoint': rule.endpoint,
            'methods': list(rule.methods),
            'rule': str(rule)
        })
    return jsonify({'routes': routes})

@app.route('/test-convert', methods=['POST'])
def test_convert():
    """Simple test for convert functionality"""
    try:
        data = request.get_json(force=True)
        return jsonify({
            'success': True,
            'received_data': data,
            'message': 'Convert endpoint is working'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ALL YOUR EXISTING ENDPOINTS WITH CREDIT CHECKS ADDED

@app.route('/')
def home():
    return "Solthron API is running"

@app.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.get_json(force=True)
        topic = data.get('topic', '').strip()
        tone = data.get('tone', 'professional')
        length = data.get('length', 'balanced')
        mode = data.get('mode', 'reframe_casual')

        if not topic:
            return jsonify({'error': 'Topic is required'}), 400

        # ADD CREDIT CHECK HERE
        credit_result = optional_credit_check(mode)
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits(mode)
            }), 402

        # Handle reframe modes
        if mode.startswith('reframe_'):
            tone = mode.split('_')[1]
            result = process_reframe_request(client, topic, tone, length)

            # Add credit info to response
            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        # Handle explain modes - RESTORED ORIGINAL TEMPLATES
        if mode.startswith('explain_'):
            if mode == 'explain_meaning':
                # ORIGINAL explain_meaning template
                template = f"""Definition:
[Concise one-line definition of the core concept]

Domain Meanings & Usage:
| [Domain1]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

| [Domain2]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

| [Domain3]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

| [Domain4]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

Related:
[3-4 closely related terms, comma-separated]"""

                response = client.chat.completions.create(
                    model="chatgpt-4o-latest",
                    messages=[
                        {
                            "role": "system",
                            "content": "Generate concise, structured explanations following the exact template format. Include relevant domain-specific meanings and authentic usage examples."
                        },
                        {
                            "role": "user",
                            "content": f"Explain this term:\n{topic}\n\nUse template:\n{template}"
                        }
                    ],
                    temperature=0.3,
                    max_tokens=400
                )

            elif mode == 'explain_story':
                # ORIGINAL explain_story template
                template = f"""Core Concept:
[One-line explanation of what it is]

Story:
[3-4 sentences that naturally explain the concept through a relatable narrative]"""

                response = client.chat.completions.create(
                    model="chatgpt-4o-latest",
                    messages=[
                        {"role": "system", "content": "Create a concise story that explains the concept naturally, without bullet points or sections."},
                        {"role": "user", "content": f"Explain this through a story:\n{topic}\n\nUse template:\n{template}"}
                    ],
                    temperature=0.3,
                    max_tokens=400
                )

            elif mode == 'explain_eli5':
                # ORIGINAL explain_eli5 approach
                response = client.chat.completions.create(
                    model="chatgpt-4o-latest",
                    messages=[
                        {"role": "system", "content": "Explain concepts using simple words, fun analogies, and examples that a 5-year-old would understand. Use short sentences and friendly language."},
                        {"role": "user", "content": f"Explain this to a 5-year-old:\n{topic}"}
                    ],
                    temperature=0.3,
                    max_tokens=400
                )

            else:
                # Fallback for any other explain modes
                template = create_explain_prompt(topic, mode)
                response = client.chat.completions.create(
                    model="chatgpt-4o-latest",
                    messages=[
                        {"role": "system", "content": template["system"]},
                        {"role": "user", "content": template["user"]}
                    ],
                    temperature=0.7
                )

            result = {
                'prompt': response.choices[0].message.content,
                'status': 'success',
                'metadata': {'mode': mode}
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        # Handle convert modes - RESTORED ORIGINAL TEMPLATES
        if mode.startswith('convert_'):
            try:
                if mode == 'convert_concise':
                    # ORIGINAL convert_concise template
                    template = f"""You will convert the following text into a clear, concise prompt.

Format Guidelines:
- One clear task statement
- Maximum 2-3 essential requirements
- No additional explanations or examples
- Keep total length under 5 lines
- Maintain professional tone

Structure:
Task: [One clear sentence]
Requirements:
1. [First key requirement]
2. [Second key requirement]
3. [Third key requirement - if absolutely necessary]

Format Requirements:
- Maximum 3 sentences
- No bullet points
- No examples unless critical
- Focus on core request

Original Text:
{topic}

Enhance this text into a clear, focused prompt that could be given to an AI system."""

                elif mode == 'convert_balanced':
                    # ORIGINAL convert_balanced template
                    template = f"""You will help convert the following text into a balanced, well-structured prompt.

Format Guidelines:
- Clear task definition
- Do not use afterrisks
- 4-5 key requirements
- One brief example
- Keep total length under 10 lines

Structure:
Task: [Clear task description]

Requirements:
1. [First requirement]
2. [Second requirement]
3. [Third requirement]
4. [Fourth requirement]
5. [Optional fifth requirement]

Example:
Scenario: [Brief example scenario]
Input: [Sample input]
Output: [Expected output]

Output Format: [Desired format]

Original Text:
{topic}

Transform this text into a balanced prompt that provides clear direction while maintaining essential context."""

                else:  # convert_detailed
                    # ORIGINAL convert_detailed template
                    template = f"""Create a comprehensive prompt about {topic}.

Format Guidelines:
- Detailed task explanation
- Do not use afterrisks
- Specific requirements and constraints
- Step-by-step guidance
- Clear examples
- Structured sections

Structure:
Task: [Comprehensive task description]

Requirements:
1. [First requirement with explanation]
2. [Second requirement with explanation]
3. [Third requirement with explanation]
[Continue with all necessary requirements]

Steps:
1. [First step with guidance]
2. [Second step with guidance]
3. [Third step with guidance]
[Continue with all necessary steps]

Examples:
1. Example Scenario: [Specific example]
   Input: [Sample input]
   Output: [Expected output]
2. [Additional example if needed]

Output Format: [Specific format requirements]

Structure Guidelines:
- Clear section headers
- Multiple related examples
- Step-by-step instructions where relevant
- Explicit success criteria
- Edge cases and exceptions

Original Text:
{topic}

Transform this text into a detailed prompt that leaves no room for ambiguity while maintaining clarity and purpose."""

                response = client.chat.completions.create(
                    model="chatgpt-4o-latest",
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an expert at creating clear, effective prompts."
                        },
                        {
                            "role": "user",
                            "content": template
                        }
                    ],
                    temperature=0.3
                )

                result = {
                    'prompt': response.choices[0].message.content,
                    'status': 'success',
                    'metadata': {'mode': mode, 'original_text': topic}
                }

                if credit_result.get('credits_used'):
                    result['credits_used'] = credit_result['credits_used']
                    result['credits_remaining'] = credit_result.get('remaining')

                return jsonify(result)

            except Exception as e:
                return jsonify({'error': str(e), 'status': 'error'}), 500

        # Handle image modes
        if mode.startswith('image_'):
            result = process_image_variation(client, topic, mode)

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        # Handle template modes (only cot now)
        if mode in ['cot']:
            result = create_enhanced_rewrite(topic, tone, length, mode)

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        # Default processing
        prompt_data = create_enhanced_rewrite(topic, tone, length)
        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {"role": "system", "content": prompt_data["system_message"]},
                {"role": "user", "content": prompt_data["user_message"]}
            ],
            temperature=0.7
        )

        result = {
            'prompt': response.choices[0].message.content,
            'status': 'success',
            'metadata': {
                'topic': topic,
                'tone': tone,
                'mode': mode
            }
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        logging.error(f"Error generating prompt: {str(e)}")
        return jsonify({
            'error': 'Failed to generate prompt',
            'details': str(e)
        }), 500

@app.route('/generate-image', methods=['POST'])
def generate_image_prompt():
    try:
        # ADD CREDIT CHECK
        credit_result = optional_credit_check('image_prompt')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('image_prompt')
            }), 402

        data = request.get_json(force=True)
        image_url = data.get('image')

        universal_prompt = """Analyze this image with extreme thoroughness and precision. Examine every single visual element, no matter how minute. Study the image as if you need to recreate it perfectly from memory. Provide output in this exact format:

Description: [4-5 line comprehensive description capturing the complete scene, all subjects, actions, and significant visual elements in detail]

Primary Subject(s): [main subject(s) with detailed description - pose, body language, facial expressions, age estimation, gender, ethnicity if apparent, clothing brand/style/condition, accessories, jewelry, footwear, hair style/color, makeup, gestures, what they're doing/holding]

Secondary Elements: [people, animals, or objects in background/periphery with their positions, actions, and details]

Environment/Setting: [specific location type, indoor/outdoor, architectural style, room type, landscape features, weather conditions, season indicators, time of day evidence, geographical clues, cultural context]

Colors & Visual Palette: [dominant colors, accent colors, color harmony, saturation levels, color temperature (warm/cool), specific color names, color distribution across image]

Lighting Analysis: [light source type (natural/artificial), direction (front/back/side), intensity (harsh/soft), quality (diffused/direct), shadows (hard/soft), highlights, reflections, ambient lighting, contrast levels]

Materials & Textures: [fabric types, surface materials, texture quality (smooth/rough/glossy/matte), material condition (new/worn/damaged), patterns, weaves, finishes]

Style & Technique: [photography style, artistic medium, visual technique, filter effects, processing style, camera type indicators, lens characteristics, depth of field, bokeh quality]

Composition & Framing: [camera angle (high/low/eye level), perspective (wide/close-up/macro), framing (tight/loose), rule of thirds application, leading lines, symmetry/asymmetry, balance, focal points, negative space usage]

Technical Quality: [image resolution indicators, sharpness, noise levels, compression artifacts, dynamic range, exposure quality] --ar [width:height ratio] --v 5.2

Text & Graphics: [any visible text (exact words), fonts, signs, labels, logos, brand names, symbols, graphics, artwork, posters, screens, digital displays]

Spatial Relationships: [how objects relate to each other, size comparisons, distance relationships, layering (foreground/midground/background), overlap patterns, perspective cues]

Motion & Action: [any movement indicators, blur patterns, action sequences, dynamic elements, static vs moving elements]

Mood & Atmosphere: [emotional tone, energy level, ambiance, psychological impact, cultural mood, formality level, tension/relaxation]

Temporal Indicators: [time period clues, historical markers, technology visible, fashion era, architectural period, anachronisms]

Fine Details: [small background objects, wear patterns, aging signs, scratches/damage, reflections in surfaces, shadows of unseen objects, partial text, edge details, corner elements, pattern specifics, brand markings, serial numbers, dates, signatures]

Anomalies & Unique Features: [anything unusual, unexpected, hidden elements, visual tricks, easter eggs, inconsistencies, artistic choices, creative elements, surreal aspects]

Do not use afterrisks in the output"""

        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {
                    "role": "system",
                    "content": "Generate precise image analysis following the universal prompt format."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": universal_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_url,
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens=500
        )

        result = {
            'prompt': response.choices[0].message.content,
            'status': 'success'
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        logging.error(f"Error: {str(e)}")
        return jsonify({'error': str(e), 'status': 'error'}), 500

@app.route('/generate-caption', methods=['POST'])
def generate_caption():
    try:
        # ADD CREDIT CHECK
        credit_result = optional_credit_check('image_caption')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('image_caption')
            }), 402

        data = request.get_json(force=True)
        image_url = data.get('image')

        social_caption_prompt = """Analyze this image and generate platform-specific captions in the following format, do not use asterisks::

Instagram:
[Write an engaging, conversational caption with emojis]
.
.
.
#[relevant hashtags, maximum 15]

Facebook:
[Write a longer, more detailed description that tells a story and encourages engagement]

Twitter/X:
[Write a concise, catchy caption within 280 characters, include 2-3 relevant hashtags]

LinkedIn:
[Write a professional caption that provides business context or insight]
→ [Add one key professional takeaway or insight]
---
#[3-4 relevant professional hashtags]"""

        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {
                    "role": "system",
                    "content": "Generate engaging, platform-optimized social media captions."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": social_caption_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_url,
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens=500
        )

        result = {
            'prompt': response.choices[0].message.content,
            'status': 'success'
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        logging.error(f"Error: {str(e)}")
        return jsonify({'error': str(e), 'status': 'error'}), 500

@app.route('/explain-meaning', methods=['POST'])
def explain_meaning():
    # ADD CREDIT CHECK
    credit_result = optional_credit_check('explain_meaning')
    if not credit_result['success']:
        return jsonify({
            'error': credit_result['message'],
            'credits_required': get_feature_credits('explain_meaning')
        }), 402

    data = request.get_json(force=True)
    text = data.get('text', '').strip()

    # ORIGINAL explain_meaning template
    template = f"""Definition:
[Concise one-line definition of the core concept]

Domain Meanings & Usage:
| [Domain1]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

| [Domain2]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

| [Domain3]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

| [Domain4]: [Specific meaning in this domain]
  "[Example sentence showing usage]"

Related:
[3-4 closely related terms, comma-separated]"""

    response = client.chat.completions.create(
        model="chatgpt-4o-latest",
        messages=[
            {
                "role": "system",
                "content": "Generate concise, structured explanations following the exact template format. Include relevant domain-specific meanings and authentic usage examples."
            },
            {
                "role": "user",
                "content": f"Explain this term:\n{text}\n\nUse template:\n{template}"
            }
        ],
        temperature=0.3,
        max_tokens=400
    )

    result = {'explanation': response.choices[0].message.content}

    if credit_result.get('credits_used'):
        result['credits_used'] = credit_result['credits_used']
        result['credits_remaining'] = credit_result.get('remaining')

    return jsonify(result)

@app.route('/explain-story', methods=['POST'])
def explain_story():
    # ADD CREDIT CHECK
    credit_result = optional_credit_check('explain_story')
    if not credit_result['success']:
        return jsonify({
            'error': credit_result['message'],
            'credits_required': get_feature_credits('explain_story')
        }), 402

    data = request.get_json(force=True)
    text = data.get('text', '').strip()

    # ORIGINAL explain_story template
    template = f"""Core Concept:
[One-line explanation of what it is]

Story:
[3-4 sentences that naturally explain the concept through a relatable narrative]"""

    response = client.chat.completions.create(
        model="chatgpt-4o-latest",
        messages=[
            {"role": "system", "content": "Create a concise story that explains the concept naturally, without bullet points or sections."},
            {"role": "user", "content": f"Explain this through a story:\n{text}\n\nUse template:\n{template}"}
        ],
        temperature=0.3,
        max_tokens=400
    )

    result = {'explanation': response.choices[0].message.content}

    if credit_result.get('credits_used'):
        result['credits_used'] = credit_result['credits_used']
        result['credits_remaining'] = credit_result.get('remaining')

    return jsonify(result)

@app.route('/explain-eli5', methods=['POST'])
def explain_eli5():
    # ADD CREDIT CHECK
    credit_result = optional_credit_check('explain_eli5')
    if not credit_result['success']:
        return jsonify({
            'error': credit_result['message'],
            'credits_required': get_feature_credits('explain_eli5')
        }), 402

    data = request.get_json(force=True)
    text = data.get('text', '').strip()

    # ORIGINAL explain_eli5 approach
    response = client.chat.completions.create(
        model="chatgpt-4o-latest",
        messages=[
            {"role": "system", "content": "Explain concepts using simple words, fun analogies, and examples that a 5-year-old would understand. Use short sentences and friendly language."},
            {"role": "user", "content": f"Explain this to a 5-year-old:\n{text}"}
        ],
        temperature=0.3,
        max_tokens=400
    )

    result = {'explanation': response.choices[0].message.content}

    if credit_result.get('credits_used'):
        result['credits_used'] = credit_result['credits_used']
        result['credits_remaining'] = credit_result.get('remaining')

    return jsonify(result)

@app.route('/convert-concise', methods=['POST'])
def convert_concise():
    """Convert input to a concise prompt using specific strategies."""
    try:
        # ADD CREDIT CHECK
        credit_result = optional_credit_check('convert_concise')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('convert_concise')
            }), 402

        data = request.get_json(force=True)
        topic = data.get('topic', '').strip()

        # ORIGINAL convert_concise template
        template = f"""You will convert the following text into a clear, concise prompt.

Format Guidelines:
- One clear task statement
- Maximum 2-3 essential requirements
- No additional explanations or examples
- Keep total length under 5 lines
- Maintain professional tone

Structure:
Task: [One clear sentence]
Requirements:
1. [First key requirement]
2. [Second key requirement]
3. [Third key requirement - if absolutely necessary]

Format Requirements:
- Maximum 3 sentences
- No bullet points
- No examples unless critical
- Focus on core request

Original Text:
{topic}

Enhance this text into a clear, focused prompt that could be given to an AI system."""

        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at converting text into clear, concise prompts."
                },
                {
                    "role": "user",
                    "content": template
                }
            ],
            temperature=0.3
        )

        result = {
            'prompt': response.choices[0].message.content,
            'status': 'success',
            'metadata': {
                'mode': 'concise',
                'original_text': topic
            }
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'status': 'error'}), 500

@app.route('/convert-balanced', methods=['POST'])
def convert_balanced():
    """Convert input to a balanced prompt with moderate detail."""
    try:
        # ADD CREDIT CHECK
        credit_result = optional_credit_check('convert_balanced')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('convert_balanced')
            }), 402

        data = request.get_json(force=True)
        topic = data.get('topic', '').strip()

        # ORIGINAL convert_balanced template
        template = f"""You will help convert the following text into a balanced, well-structured prompt.

Format Guidelines:
- Clear task definition
- Do not use afterrisks
- 4-5 key requirements
- One brief example
- Keep total length under 10 lines

Structure:
Task: [Clear task description]

Requirements:
1. [First requirement]
2. [Second requirement]
3. [Third requirement]
4. [Fourth requirement]
5. [Optional fifth requirement]

Example:
Scenario: [Brief example scenario]
Input: [Sample input]
Output: [Expected output]

Output Format: [Desired format]

Original Text:
{topic}

Transform this text into a balanced prompt that provides clear direction while maintaining essential context."""

        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at creating well-balanced prompts that provide the right level of detail."
                },
                {
                    "role": "user",
                    "content": template
                }
            ],
            temperature=0.4
        )

        result = {
            'prompt': response.choices[0].message.content,
            'status': 'success',
            'metadata': {
                'mode': 'balanced',
                'original_text': topic
            }
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'status': 'error'}), 500

@app.route('/convert-detailed', methods=['POST'])
def convert_detailed():
    """Convert input to a detailed prompt with comprehensive specifications."""
    try:
        # ADD CREDIT CHECK
        credit_result = optional_credit_check('convert_detailed')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('convert_detailed')
            }), 402

        data = request.get_json(force=True)
        topic = data.get('topic', '').strip()

        # ORIGINAL convert_detailed template
        template = f"""Create a comprehensive prompt about {topic}.

Format Guidelines:
- Detailed task explanation
- Do not use afterrisks
- Specific requirements and constraints
- Step-by-step guidance
- Clear examples
- Structured sections

Structure:
Task: [Comprehensive task description]

Requirements:
1. [First requirement with explanation]
2. [Second requirement with explanation]
3. [Third requirement with explanation]
[Continue with all necessary requirements]

Steps:
1. [First step with guidance]
2. [Second step with guidance]
3. [Third step with guidance]
[Continue with all necessary steps]

Examples:
1. Example Scenario: [Specific example]
   Input: [Sample input]
   Output: [Expected output]
2. [Additional example if needed]

Output Format: [Specific format requirements]

Structure Guidelines:
- Clear section headers
- Multiple related examples
- Step-by-step instructions where relevant
- Explicit success criteria
- Edge cases and exceptions

Original Text:
{topic}

Transform this text into a detailed prompt that leaves no room for ambiguity while maintaining clarity and purpose."""

        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at creating detailed, comprehensive prompts that capture all necessary specifications, and dont use # or * in your output"
                },
                {
                    "role": "user",
                    "content": template
                }
            ],
            temperature=0.5
        )

        result = {
            'prompt': response.choices[0].message.content,
            'status': 'success',
            'metadata': {
                'mode': 'detailed',
                'original_text': topic
            }
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'status': 'error'}), 500

# KEEP ALL YOUR EXISTING SMART FOLLOWUPS, ENHANCEMENTS, ACTIONS, AND PERSONA ENDPOINTS...

# Smart Follow-ups helper functions
def get_focus_for_session(conversation):
    """Simple rotation based on conversation hash - no storage needed"""

    focus_options = [
        "Ask about practical next steps and what to try first",
        "Ask about different ways to approach the same thing",
        "Ask about potential problems or things that might go wrong",
        "Ask about how this would work in real situations",
        "Ask about things that might be missing or overlooked",
        "Ask about what resources or help would be needed",
        "Ask about how this connects with other things they're doing",
        "Ask about how to know if it's working or successful"
    ]

    # Use conversation content to deterministically pick focus (no randomness)
    focus_index = abs(hash(conversation[:200])) % len(focus_options)
    return focus_options[focus_index]

def extract_key_terms(conversation_snippet):
    """Extract key terms from conversation for better fallback questions"""
    try:
        # Simple keyword extraction - look for capitalized words, technical terms, etc.
        import re

        # Find potential key terms (capitalized words, technical patterns)
        patterns = [
            r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b',  # Proper nouns
            r'\b(?:API|SDK|AI|ML|UI|UX|SaaS|MVP|POC)\b',  # Common tech acronyms
            r'\b\w+(?:\.js|\.py|\.com|\.org)\b',  # File extensions, domains
            r'\b(?:React|Vue|Angular|Python|JavaScript|Node|Docker|AWS|Azure)\b'  # Common tech terms
        ]

        key_terms = []
        for pattern in patterns:
            matches = re.findall(pattern, conversation_snippet, re.IGNORECASE)
            key_terms.extend(matches)

        # Remove duplicates and return top 3
        unique_terms = list(dict.fromkeys(key_terms))
        return unique_terms[:3]

    except Exception:
        return []

def build_enhanced_prompt(conversation, focus_type):
    """Build enhanced prompt with focus rotation and specificity requirements"""

    return f"""
You're helping someone continue their conversation by suggesting 5 things they might want to explore next.

CONVERSATION:
{conversation[:1800]}

Generate 5 follow-up questions that feel natural and helpful. Mix of approaches:
- 2 practical/simple questions (what someone curious would ask)
- 2 slightly deeper questions (but still conversational)
- 1 action-oriented question (what to DO next - asking for practical steps or advice)

Guidelines:
✓ Reference specific things mentioned in the conversation
✓ Keep questions conversational and approachable
✓ Ask what a curious friend might genuinely want to know
✓ Avoid business jargon and academic language
✓ {focus_type}

Question Style Examples:
- "Have you tried [specific approach mentioned]?"
- "What happens if [specific scenario]?"
- "Could you walk through how [specific part] works?"
- "What's been your biggest challenge with [specific thing]?"
- "Have you considered starting with [simpler version]?"

For action questions specifically - ask for practical steps:
- "What would you recommend trying first with [specific thing]?"
- "How should I get started with [specific approach]?"
- "What's the simplest way to test [specific idea]?"
- "What tools would work best for [specific task]?"

Make questions feel like natural conversation flow - what would you genuinely want to know next?

JSON format:
{{
    "questions": [
        {{"text": "Simple, curious question?", "type": "curious"}},
        {{"text": "Another practical question?", "type": "practical"}},
        {{"text": "Slightly deeper but still conversational question?", "type": "deeper"}},
        {{"text": "Another conversational exploration question?", "type": "exploration"}},
        {{"text": "What should I do/try next with [specific thing]?", "type": "action"}}
    ],
    "analysis": "What would help move this conversation forward"
}}"""

@app.route('/smart-followups', methods=['POST'])
def smart_followups():
    """Enhanced smart follow-up questions with dynamic generation"""
    try:
        logging.info("=== Enhanced smart followups request started ===")

        # ADD CREDIT CHECK
        credit_result = optional_credit_check('smart_followups')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('smart_followups')
            }), 402

        # Parse request
        data = request.get_json(force=True)
        conversation = data.get('conversation', '').strip()
        platform = data.get('platform', 'unknown')

        logging.info(f"Conversation length: {len(conversation)}, Platform: {platform}")

        if not conversation:
            return jsonify({'error': 'Conversation content is required'}), 400

        # Get dynamic focus for this conversation
        focus_type = get_focus_for_session(conversation)
        logging.info(f"Selected focus: {focus_type}")

        # Build enhanced prompt with focus and specificity requirements
        analysis_prompt = build_enhanced_prompt(conversation, focus_type)

        # Use reliable models with proper error handling
        models_to_try = [
            {
                "name": "chatgpt-4o-latest",  # Start with most reliable model
                "params": {
                    "temperature": 0.3,  # Increased from 0.1 for more variation
                    "max_tokens": 1000
                }
            },
            {
                "name": "gpt-3.5-turbo",
                "params": {
                    "temperature": 0.3,
                    "max_tokens": 800
                }
            }
        ]

        response = None
        model_used = None

        # Try models in order
        for model_config in models_to_try:
            try:
                model_name = model_config["name"]
                params = model_config["params"]

                logging.info(f"Trying model: {model_name}")

                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": analysis_prompt}],
                    **params
                )

                model_used = model_name
                logging.info(f"Successfully used model: {model_name}")
                break

            except Exception as e:
                error_msg = str(e)
                logging.warning(f"Model {model_name} failed: {error_msg}")
                continue

        if not response:
            return jsonify({
                'success': False,
                'error': 'All AI models failed to respond'
            }), 500

        # Parse response
        ai_response = response.choices[0].message.content.strip()
        logging.info(f"AI Response length: {len(ai_response)}")

        try:
            # Clean and extract JSON
            clean_response = ai_response

            # Remove markdown code blocks
            if "```json" in clean_response:
                clean_response = clean_response.split("```json")[1].split("```")[0]
            elif "```" in clean_response:
                parts = clean_response.split("```")
                if len(parts) >= 3:
                    clean_response = parts[1]

            # Find JSON boundaries
            start_idx = clean_response.find('{')
            if start_idx == -1:
                raise json.JSONDecodeError("No JSON found", clean_response, 0)

            # Find matching closing brace
            brace_count = 0
            end_idx = -1
            for i in range(start_idx, len(clean_response)):
                if clean_response[i] == '{':
                    brace_count += 1
                elif clean_response[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_idx = i + 1
                        break

            if end_idx == -1:
                raise json.JSONDecodeError("Incomplete JSON", clean_response, start_idx)

            json_str = clean_response[start_idx:end_idx]
            parsed_response = json.loads(json_str)

            # Validate structure
            questions = parsed_response.get('questions', [])
            if not isinstance(questions, list) or len(questions) == 0:
                raise ValueError("No valid questions found")

            # Process and validate questions
            validated_questions = []
            for i, q in enumerate(questions[:5]):  # Changed from 3 to 5
                if isinstance(q, dict) and 'text' in q:
                    text = q['text'].strip()
                    if text and len(text) > 15:  # Minimum question length
                        if not text.endswith('?'):
                            text += '?'
                        validated_questions.append({
                            "text": text,
                            "type": q.get('type', 'strategic')
                        })

            if len(validated_questions) == 0:
                raise ValueError("No valid questions after processing")

            result = {
                'success': True,
                'questions': validated_questions,
                'analysis': parsed_response.get('analysis', 'Strategic insights generated'),
                'platform': platform,
                'model': model_used,
                'focus_used': focus_type,
                'enhanced': True
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        except (json.JSONDecodeError, ValueError) as e:
            logging.error(f"JSON parsing failed: {str(e)}")

            # Enhanced fallback extraction with conversation context
            questions = extract_questions_from_text(ai_response)

            result = {
                'success': True,
                'questions': questions,
                'analysis': 'Strategic questions generated to enhance discussion',
                'platform': platform,
                'model': model_used,
                'focus_used': focus_type,
                'enhanced': True,
                'fallback': True
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__

        logging.error(f"=== Enhanced smart followups error ===")
        logging.error(f"Error type: {error_type}")
        logging.error(f"Error message: {error_msg}")

        return jsonify({
            'success': False,
            'error': 'Failed to generate follow-up questions',
            'details': error_msg[:200],
            'error_type': error_type
        }), 500

@app.route('/smart-enhancements', methods=['POST'])
def smart_enhancements():
    """Generate smart enhancement suggestions based on selected text"""
    try:
        logging.info("=== Smart enhancements request started ===")

        # ADD CREDIT CHECK
        credit_result = optional_credit_check('smart_enhancements')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('smart_enhancements')
            }), 402

        # Parse request
        data = request.get_json(force=True)
        selected_text = data.get('text', '').strip()

        logging.info(f"Selected text length: {len(selected_text)}")

        if not selected_text:
            return jsonify({'error': 'Selected text is required'}), 400

        # Enhanced prompt that generates enhancement instructions WITHOUT including original text
        enhancement_prompt = f"""
You are an expert content strategist with deep understanding across all domains. Analyze the highlighted text and create 4 precise enhancement instructions.

HIGHLIGHTED TEXT TO ANALYZE:
{selected_text}

ANALYSIS FRAMEWORK:
1. Content Type & Purpose: What is this and what's it trying to achieve?
2. Current Quality Level: Strengths and improvement opportunities
3. Context Clues: Infer the user's likely goals and constraints
4. Enhancement Vectors: Identify the 4 most impactful improvement areas

ENHANCEMENT INSTRUCTION REQUIREMENTS:
- Each must be a clear, actionable instruction
- Focus on specific improvements, not vague suggestions
- Be immediately copy-pasteable as a prompt
- Do NOT include the original text in the instruction
- Start with action verbs like "Enhance", "Improve", "Add", "Refine"

INSTRUCTION FORMULA: "[Action verb] this [content type] by [specific improvement instructions]"

JSON FORMAT:
{{
    "content_analysis": {{
        "type": "What type of content this is",
        "purpose": "What it's trying to achieve",
        "current_quality": "Brief assessment",
        "improvement_potential": "Key areas for enhancement"
    }},
    "enhancement_prompts": [
        {{
            "prompt": "Clear enhancement instruction WITHOUT original text",
            "focus_area": "Primary improvement focus",
            "expected_impact": "What this will improve",
            "priority": "high/medium/low"
        }},
        {{
            "prompt": "Second enhancement instruction focusing on different aspect",
            "focus_area": "Different improvement aspect",
            "expected_impact": "Different improvement outcome",
            "priority": "high/medium/low"
        }},
        {{
            "prompt": "Third enhancement instruction with another angle",
            "focus_area": "Another improvement angle",
            "expected_impact": "Another improvement outcome",
            "priority": "high/medium/low"
        }},
        {{
            "prompt": "Fourth enhancement instruction with final dimension",
            "focus_area": "Final improvement dimension",
            "expected_impact": "Final improvement outcome",
            "priority": "high/medium/low"
        }}
    ]
}}

IMPORTANT: Do NOT include the original text in any of the enhancement prompts. Only provide the improvement instructions."""

        # Use GPT-4.1 as primary model with smart fallbacks
        models_to_try = [
            {
                "name": "chatgpt-4o-latest",  # Latest GPT-4.1
                "params": {
                    "temperature": 0.1,    # Very focused for precise suggestions
                    "max_tokens": 2500,    # Leverage the large output capacity
                    "top_p": 0.95,        # Slight creativity for varied suggestions
                }
            },
            {
                "name": "gpt-4o",  # Strong fallback
                "params": {
                    "temperature": 0.2,
                    "max_tokens": 2000
                }
            }
        ]

        response = None
        model_used = None

        for model_config in models_to_try:
            try:
                model_name = model_config["name"]
                params = model_config["params"]

                logging.info(f"Attempting smart enhancements with {model_name}")

                response = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a world-class content strategist and prompt engineer. Your expertise spans writing, coding, business strategy, creative work, and technical documentation. You create enhancement instructions that deliver transformative improvements. Never include the original text in your enhancement instructions."
                        },
                        {
                            "role": "user",
                            "content": enhancement_prompt
                        }
                    ],
                    **params
                )

                model_used = model_name
                logging.info(f"✅ Smart enhancements successful with {model_name}")
                break

            except Exception as e:
                error_msg = str(e)
                logging.warning(f"❌ {model_name} failed: {error_msg}")
                continue

        if not response:
            return jsonify({
                'success': False,
                'error': 'All models failed to respond'
            }), 500

        # Enhanced response processing
        ai_response = response.choices[0].message.content.strip()
        logging.info(f"Generated {len(ai_response)} chars with {model_used}")

        try:
            # Parse JSON with enhanced quality
            parsed_data = parse_json_response_enhanced(ai_response)

            # Extract and validate enhancement prompts
            enhancement_prompts = parsed_data.get('enhancement_prompts', [])
            content_analysis = parsed_data.get('content_analysis', {})

            # Ensure high-quality prompts
            validated_prompts = []
            for prompt_data in enhancement_prompts:
                if isinstance(prompt_data, dict) and 'prompt' in prompt_data:
                    prompt_text = prompt_data['prompt'].strip()
                    if len(prompt_text) > 20:
                        validated_prompts.append({
                            "prompt": prompt_text,
                            "focus_area": prompt_data.get('focus_area', 'improvement'),
                            "expected_impact": prompt_data.get('expected_impact', 'Enhanced quality'),
                            "priority": prompt_data.get('priority', 'medium')
                        })

            if len(validated_prompts) == 0:
                raise ValueError("No valid enhancement prompts generated")

            result = {
                'success': True,
                'content_analysis': content_analysis,
                'enhancement_prompts': validated_prompts,
                'model_used': model_used,
                'original_length': len(selected_text),
                'gpt_4_1_used': "gpt-4.1" in model_used
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        except Exception as e:
            logging.error(f"Response processing failed: {str(e)}")

            # Create premium fallback prompts WITHOUT original text
            fallback_prompts = create_gpt41_fallback_prompts_clean(selected_text)

            result = {
                'success': True,
                'content_analysis': {"type": "Content analyzed", "purpose": "Enhancement ready"},
                'enhancement_prompts': fallback_prompts,
                'model_used': model_used,
                'fallback': True
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__

        logging.error(f"=== Smart enhancements error ===")
        logging.error(f"Error type: {error_type}")
        logging.error(f"Error message: {error_msg}")

        return jsonify({
            'success': False,
            'error': 'Failed to generate enhancement suggestions',
            'details': error_msg[:200],
            'error_type': error_type
        }), 500

# Smart Actions helper functions
def build_action_prompt(conversation, platform):
    """Build action-focused prompt for generating actionable follow-up prompts"""

    return f"""
You're helping someone continue their AI conversation by suggesting 3 action-oriented follow-up prompts they can use.

CONVERSATION:
{conversation[:1800]}

Generate 3 follow-up prompts that are:
- Action-oriented and practical (focus on "what to do" rather than "what to know")
- Context-aware and specific to their conversation
- Ready to copy-paste back into the AI chat
- 2-liner prompts that get specific, actionable guidance

Think about what the person would naturally want to DO next based on this conversation:
- If they're learning → How to apply/practice it
- If they're problem-solving → Next steps to try
- If they're planning → How to implement/start
- If they're stuck → Specific approaches to attempt

Guidelines:
✓ Reference specific things mentioned in the conversation
✓ Focus on implementation and application
✓ Make prompts specific enough to get actionable responses
✓ Avoid generic questions - be contextually relevant
✓ Each prompt should be self-contained and ready to use

JSON format:
{{
    "action_prompts": [
        {{
            "prompt": "Context-specific action-oriented prompt for the AI",
            "focus": "implementation/application/practice",
            "context": "brief description of what this targets"
        }},
        {{
            "prompt": "Second practical follow-up prompt",
            "focus": "planning/strategy/approach",
            "context": "what this helps with"
        }},
        {{
            "prompt": "Third actionable prompt for next steps",
            "focus": "execution/practice/testing",
            "context": "practical outcome"
        }}
    ],
    "analysis": "Brief explanation of how these prompts help take action on the conversation"
}}"""

def extract_action_prompts_from_text(text, conversation=""):
    """Fallback extraction for action prompts when JSON parsing fails"""
    prompts = []
    lines = text.split('\n')

    for line in lines:
        line = line.strip()
        # Look for action-oriented prompt language
        if any(starter in line.lower() for starter in ['help me', 'show me', 'create', 'give me', 'walk me through', 'build', 'plan', 'strategy', 'implement']):
            if len(line) > 40 and len(line) < 500 and '?' in line:
                clean_prompt = line

                # Remove common prefixes
                prefixes = ['"prompt":', 'prompt:', '"', "'", '-', '•', '*', '1.', '2.', '3.']
                for prefix in prefixes:
                    if clean_prompt.startswith(prefix):
                        clean_prompt = clean_prompt[len(prefix):].strip()

                clean_prompt = clean_prompt.rstrip('",\'"').strip()

                if clean_prompt and len(clean_prompt) > 35:
                    prompts.append({
                        "prompt": clean_prompt,
                        "focus": "practical",
                        "context": "actionable guidance"
                    })

    # If no prompts extracted, provide high-quality context-aware defaults
    if len(prompts) == 0:
        prompts = [
            {"prompt": "Help me create an action plan based on our discussion. What are the specific next steps I should take?", "focus": "planning", "context": "next steps"},
            {"prompt": "Give me 3 practical ways to apply what we've discussed. Include specific examples for my situation.", "focus": "application", "context": "practical use"},
            {"prompt": "Walk me through how to get started with this approach. What should I do first and why?", "focus": "getting started", "context": "initial steps"}
        ]

    return prompts[:3]

@app.route('/smart-actions', methods=['POST'])
def smart_actions():
    """Generate smart action-oriented follow-up prompts based on conversation context"""
    try:
        logging.info("=== Smart actions request started ===")

        # ADD CREDIT CHECK
        credit_result = optional_credit_check('smart_actions')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('smart_actions')
            }), 402

        # Parse request
        data = request.get_json(force=True)
        conversation = data.get('conversation', '').strip()
        platform = data.get('platform', 'unknown')

        logging.info(f"Conversation length: {len(conversation)}, Platform: {platform}")

        if not conversation:
            return jsonify({'error': 'Conversation content is required'}), 400

        # Build action-focused prompt
        action_prompt = build_action_prompt(conversation, platform)

        # Use reliable models with proper error handling
        models_to_try = [
            {
                "name": "chatgpt-4o-latest",
                "params": {
                    "temperature": 0.3,
                    "max_tokens": 800
                }
            },
            {
                "name": "gpt-3.5-turbo",
                "params": {
                    "temperature": 0.3,
                    "max_tokens": 600
                }
            }
        ]

        response = None
        model_used = None

        # Try models in order
        for model_config in models_to_try:
            try:
                model_name = model_config["name"]
                params = model_config["params"]

                logging.info(f"Trying model: {model_name}")

                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": action_prompt}],
                    **params
                )

                model_used = model_name
                logging.info(f"Successfully used model: {model_name}")
                break

            except Exception as e:
                error_msg = str(e)
                logging.warning(f"Model {model_name} failed: {error_msg}")
                continue

        if not response:
            return jsonify({
                'success': False,
                'error': 'All AI models failed to respond'
            }), 500

        # Parse response
        ai_response = response.choices[0].message.content.strip()
        logging.info(f"AI Response length: {len(ai_response)}")

        try:
            # Parse JSON response
            parsed_response = parse_json_response_enhanced(ai_response)

            # Extract and validate action prompts
            action_prompts = parsed_response.get('action_prompts', [])

            if not isinstance(action_prompts, list) or len(action_prompts) == 0:
                raise ValueError("No valid action prompts found")

            # Process and validate prompts
            validated_prompts = []
            for prompt_item in action_prompts[:3]:  # Limit to 3 prompts
                if isinstance(prompt_item, dict) and 'prompt' in prompt_item:
                    prompt_text = prompt_item['prompt'].strip()
                    if prompt_text and len(prompt_text) > 30:
                        validated_prompts.append({
                            "prompt": prompt_text,
                            "focus": prompt_item.get('focus', 'practical'),
                            "context": prompt_item.get('context', 'general')
                        })

            if len(validated_prompts) == 0:
                raise ValueError("No valid prompts after processing")

            result = {
                'success': True,
                'action_prompts': validated_prompts,
                'analysis': parsed_response.get('analysis', 'Action-oriented prompts generated'),
                'platform': platform,
                'model': model_used
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

        except (json.JSONDecodeError, ValueError) as e:
            logging.error(f"JSON parsing failed: {str(e)}")

            # Fallback extraction
            action_prompts = extract_action_prompts_from_text(ai_response, conversation)

            result = {
                'success': True,
                'action_prompts': action_prompts,
                'analysis': 'Action-oriented prompts generated',
                'platform': platform,
                'model': model_used,
                'fallback': True
            }

            if credit_result.get('credits_used'):
                result['credits_used'] = credit_result['credits_used']
                result['credits_remaining'] = credit_result.get('remaining')

            return jsonify(result)

    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__

        logging.error(f"=== Smart actions error ===")
        logging.error(f"Error type: {error_type}")
        logging.error(f"Error message: {error_msg}")

        return jsonify({
            'success': False,
            'error': 'Failed to generate action prompts',
            'details': error_msg[:200],
            'error_type': error_type
        }), 500

# Persona generation functions
def generate_ai_persona_analysis(keyword):
    """Use AI to analyze the role and generate persona components"""

    analysis_prompt = f"""Analyze the role "{keyword}" and provide structured information.

Role to analyze: {keyword}

Please provide a JSON response with the following structure:
{{
    "role_title": "Clean, professional title for this role",
    "experience_level": "junior/mid/senior/expert (inferred from the keyword)",
    "core_skills": [
        "skill 1",
        "skill 2",
        "skill 3",
        "skill 4",
        "skill 5"
    ],
    "communication_style": [
        "communication preference 1",
        "communication preference 2",
        "communication preference 3"
    ],
    "tools_technologies": [
        "tool/technology 1",
        "tool/technology 2"
    ],
    "primary_responsibilities": [
        "responsibility 1",
        "responsibility 2",
        "responsibility 3"
    ],
    "industry_context": "industry or business context",
    "key_phrases": [
        "phrase they would commonly use 1",
        "phrase they would commonly use 2"
    ]
}}

Focus on being specific and practical. If the role includes level indicators (senior, junior, lead, etc.), reflect that in experience_level and adjust skills accordingly."""

    try:
        response = client.chat.completions.create(
            model="chatgpt-4o-latest",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert HR analyst and role researcher. Provide accurate, practical information about professional roles. Always respond with valid JSON only."
                },
                {
                    "role": "user",
                    "content": analysis_prompt
                }
            ],
            temperature=0.3,
            max_tokens=1000
        )

        ai_response = response.choices[0].message.content.strip()

        # Clean the response - remove markdown code blocks if present
        if "```json" in ai_response:
            ai_response = ai_response.split("```json")[1].split("```")[0]
        elif "```" in ai_response:
            ai_response = ai_response.split("```")[1].split("```")[0]

        # Parse JSON response
        try:
            analysis_data = json.loads(ai_response)
            return analysis_data
        except json.JSONDecodeError as e:
            logging.error(f"JSON parsing failed: {str(e)}")
            logging.error(f"AI Response: {ai_response}")
            return None

    except Exception as e:
        logging.error(f"AI analysis failed: {str(e)}")
        return None

def build_persona_from_ai_analysis(analysis_data, keyword):
    """Build persona template from AI analysis data"""

    if not analysis_data:
        # Fallback if AI analysis fails
        return f"""You are a {keyword} with professional expertise in your field.

Core Competencies:
• Professional knowledge in {keyword} domain
• Problem-solving and analytical thinking
• Communication and collaboration skills
• Continuous learning and adaptation

Communication Approach:
Provide expert advice with clear reasoning and practical examples. Focus on actionable solutions and best practices.

Response Guidelines:
• Acknowledge the user's specific question
• Provide professional-level insights
• Include practical examples and recommendations
• Ask follow-up questions to ensure clarity

Remember: You're a knowledgeable {keyword} ready to help solve real problems with your expertise."""

    # Extract data with fallbacks
    role_title = analysis_data.get('role_title', keyword)
    experience_level = analysis_data.get('experience_level', 'professional')
    core_skills = analysis_data.get('core_skills', [])
    communication_style = analysis_data.get('communication_style', [])
    tools_technologies = analysis_data.get('tools_technologies', [])
    primary_responsibilities = analysis_data.get('primary_responsibilities', [])
    industry_context = analysis_data.get('industry_context', '')
    key_phrases = analysis_data.get('key_phrases', [])

    # Build introduction
    intro = f"You are a {experience_level} {role_title}"
    if industry_context:
        intro += f" working in {industry_context}"
    intro += ". You bring specialized expertise and practical experience to solve complex challenges in your field."

    # Build skills section
    skills_section = "Core Competencies:"
    if core_skills:
        for skill in core_skills:
            skills_section += f"\n• {skill}"
    else:
        skills_section += f"\n• Professional expertise in {keyword}"

    # Build responsibilities section
    responsibilities_section = ""
    if primary_responsibilities:
        responsibilities_section = "\nPrimary Responsibilities:"
        for responsibility in primary_responsibilities:
            responsibilities_section += f"\n• {responsibility}"

    # Build communication section
    communication_section = "Communication Approach:"
    if communication_style:
        communication_text = " ".join(communication_style)
        communication_section += f"\n{communication_text}"
    else:
        communication_section += "\nProvide expert advice with clear reasoning and practical examples."

    # Build tools section
    tools_section = ""
    if tools_technologies:
        tools_section = "\nTools & Technologies:"
        for tool in tools_technologies:
            tools_section += f"\n• {tool}"

    # Build key phrases section
    phrases_section = ""
    if key_phrases:
        phrases_section = "\nKey Phrases You Use:"
        for phrase in key_phrases[:3]:  # Limit to 3 phrases
            phrases_section += f"\n• \"{phrase}\""

    # Experience level specific additions
    experience_additions = ""
    if experience_level in ['senior', 'expert', 'lead']:
        experience_additions = """
Leadership Qualities:
• Mentor and guide team members
• Make strategic decisions and provide direction
• Drive best practices and innovation
• Collaborate across departments and stakeholders"""

    # Build final template
    template = f"""{intro}

{skills_section}{responsibilities_section}{experience_additions}

{communication_section}{tools_section}{phrases_section}

Response Guidelines:
• Start by understanding the specific challenge or question
• Provide {experience_level}-level insights appropriate to a {role_title}
• Draw from your professional experience and industry knowledge
• Include specific examples and actionable recommendations
• End with clarifying questions to ensure you're addressing core needs

Professional Identity:
"As a {experience_level} {role_title}, I bring {len(core_skills)} key competencies to help solve your challenges effectively."

Remember: You're not just providing information - you're a {experience_level} {role_title} ready to apply your specialized knowledge to solve real problems."""

    return template

def create_dynamic_persona_template(context):
    """Main function to create AI-powered dynamic persona"""
    keyword = context['keyword']

    logging.info(f"Generating AI-powered persona for: {keyword}")

    # Get AI analysis of the role
    analysis_data = generate_ai_persona_analysis(keyword)

    # Build persona template from AI analysis
    persona_template = build_persona_from_ai_analysis(analysis_data, keyword)

    return persona_template

def detect_domain_context(text):
    """Enhanced domain and context detection for persona generation"""
    text_lower = text.lower()

    # More comprehensive domain patterns with better keyword matching
    domain_patterns = {
        'technology': {
            'keywords': ['python', 'javascript', 'react', 'node', 'developer', 'programmer', 'software', 'coding', 'programming', 'ai', 'machine learning', 'data science', 'cybersecurity', 'cloud', 'devops', 'blockchain', 'api', 'database', 'frontend', 'backend', 'fullstack', 'web development', 'mobile development', 'ios', 'android', 'java', 'c++', 'php', 'ruby', 'go', 'rust', 'typescript', 'vue', 'angular'],
            'weight': 1.0
        },
        'business': {
            'keywords': ['marketing', 'sales', 'business', 'strategy', 'management', 'leadership', 'finance', 'consulting', 'entrepreneur', 'startup', 'revenue', 'profit', 'roi', 'kpi', 'analytics', 'growth hacking', 'digital marketing', 'social media', 'seo', 'ppc', 'content marketing', 'email marketing', 'brand', 'branding'],
            'weight': 1.0
        },
        'creative': {
            'keywords': ['design', 'designer', 'art', 'artist', 'creative', 'writing', 'writer', 'content', 'video', 'photography', 'photographer', 'graphics', 'ui', 'ux', 'storytelling', 'music', 'animation', 'illustration', 'copywriter', 'creative director'],
            'weight': 1.0
        },
        'education': {
            'keywords': ['teacher', 'teaching', 'education', 'training', 'trainer', 'learning', 'curriculum', 'academic', 'research', 'researcher', 'science', 'professor', 'tutor', 'course', 'study', 'instructor'],
            'weight': 1.0
        },
        'healthcare': {
            'keywords': ['medical', 'health', 'doctor', 'nurse', 'therapy', 'therapist', 'wellness', 'fitness', 'nutrition', 'psychology', 'psychologist', 'mental health', 'patient', 'healthcare', 'physician'],
            'weight': 1.0
        },
        'legal': {
            'keywords': ['legal', 'law', 'lawyer', 'attorney', 'court', 'contract', 'compliance', 'regulation', 'policy', 'rights', 'paralegal', 'legal counsel'],
            'weight': 1.0
        },
        'finance': {
            'keywords': ['finance', 'financial', 'accountant', 'accounting', 'investment', 'investor', 'banking', 'fintech', 'cryptocurrency', 'trading', 'analyst', 'cfo', 'bookkeeper'],
            'weight': 1.0
        }
    }

    domain_scores = {}

    # Score each domain based on keyword matches
    for domain, config in domain_patterns.items():
        score = 0
        for keyword in config['keywords']:
            if keyword in text_lower:
                score += config['weight']
                # Bonus for exact matches
                if keyword == text_lower.strip():
                    score += 2
        domain_scores[domain] = score

    # Find the domain with highest score
    detected_domain = max(domain_scores, key=domain_scores.get) if max(domain_scores.values()) > 0 else 'general'

    # Detect communication tone
    tone_patterns = {
        'expert': ['senior', 'lead', 'principal', 'expert', 'specialist', 'advanced', 'architect'],
        'casual': ['friendly', 'casual', 'relaxed', 'informal', 'conversational', 'buddy'],
        'creative': ['creative', 'innovative', 'artistic', 'imaginative', 'original', 'visionary'],
        'professional': ['professional', 'business', 'corporate', 'executive', 'formal']  # default
    }

    detected_tone = 'professional'  # default
    for tone, keywords in tone_patterns.items():
        if any(keyword in text_lower for keyword in keywords):
            detected_tone = tone
            break

    return {
        'domain': detected_domain,
        'tone': detected_tone,
        'keyword': text.strip()
    }

@app.route('/generate-persona', methods=['POST'])
def generate_persona():
    """Generate AI-powered dynamic persona template"""
    try:
        # ADD CREDIT CHECK
        credit_result = optional_credit_check('persona_generator')
        if not credit_result['success']:
            return jsonify({
                'error': credit_result['message'],
                'credits_required': get_feature_credits('persona_generator')
            }), 402

        data = request.get_json(force=True)
        keyword = data.get('text', '').strip()

        if not keyword:
            return jsonify({'error': 'Keyword is required'}), 400

        logging.info(f"=== AI Persona Generation Started ===")
        logging.info(f"Input keyword: {keyword}")

        # Detect basic context (keeping existing function for metadata)
        context = detect_domain_context(keyword)
        logging.info(f"Detected domain: {context['domain']}, tone: {context['tone']}")

        # Generate AI-powered persona
        persona_template = create_dynamic_persona_template(context)

        if not persona_template:
            raise Exception("Failed to generate persona template")

        logging.info(f"=== AI Persona Generation Completed ===")

        result = {
            'prompt': persona_template,
            'status': 'success',
            'metadata': {
                'keyword': keyword,
                'domain': context['domain'],
                'tone': context['tone'],
                'mode': 'ai_powered_persona',
                'ai_analyzed': True
            }
        }

        if credit_result.get('credits_used'):
            result['credits_used'] = credit_result['credits_used']
            result['credits_remaining'] = credit_result.get('remaining')

        return jsonify(result)

    except Exception as e:
        logging.error(f"=== AI Persona Generation Failed ===")
        logging.error(f"Error: {str(e)}")
        logging.error(f"Error type: {type(e).__name__}")

        return jsonify({
            'error': 'Failed to generate AI-powered persona',
            'details': str(e),
            'metadata': {
                'fallback_used': True,
                'ai_analyzed': False
            }
        }), 500

# MAILGUN TEST ENDPOINT - ADD THIS
@app.route('/test-mailgun-config', methods=['GET'])
def test_mailgun_config():
    """Test Mailgun configuration"""
    try:
        return jsonify({
            'status': 'success',
            'mailgun_domain': MAILGUN_DOMAIN,
            'api_key_present': bool(MAILGUN_API_KEY),
            'api_key_length': len(MAILGUN_API_KEY) if MAILGUN_API_KEY else 0,
            'frontend_url': FRONTEND_BASE_URL,
            'verification_url': VERIFICATION_BASE_URL,
            'environment_loaded': 'Environment variables loaded successfully'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e),
            'message': 'Environment variables not loaded properly'
        }), 500

# ============================================
# MAILGUN EMAIL ENDPOINTS - ADD THESE
# ============================================

@app.route('/send-verification-email', methods=['POST'])
def send_verification_email():
    """Send custom verification email via Mailgun"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        first_name = data.get('firstName', '').strip()

        if not email:
            return jsonify({'error': 'Email is required'}), 400

        print(f"📧 Sending verification email to: {email}")

        # Send via Mailgun
        result = send_verification_email_mailgun(email, first_name)

        if result["success"]:
            return jsonify({
                'success': True,
                'message': 'Verification email sent successfully',
                'provider': 'mailgun',
                'delivered_via': 'Mailgun (95%+ inbox rate)'
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Failed to send verification email',
                'error': result["message"],
                'use_firebase_fallback': True
            }), 500

    except Exception as e:
        print(f"❌ Send verification error: {e}")
        return jsonify({
            'error': 'Failed to send verification email',
            'details': str(e)
        }), 500

@app.route('/verify-email', methods=['GET'])
def verify_email():
    """Verify email using token and update Firebase user"""
    try:
        email = request.args.get('email', '').strip().lower()
        token = request.args.get('token', '').strip()

        if not email or not token:
            return f"""
            <html><body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Invalid Verification Link</h1>
            <p>The verification link is missing required parameters.</p>
            <a href="{FRONTEND_BASE_URL}/login" style="background: #ffff00; padding: 10px 20px; text-decoration: none; color: black; border-radius: 5px;">Back to Login</a>
            </body></html>
            """

        print(f"🔐 Verifying email: {email}")

        # Verify token
        if not verify_token_v2(email, token):
            print(f"❌ Invalid or expired token for {email}")
            return f"""
            <html><body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Verification Link Expired</h1>
            <p>This verification link has expired. Please request a new one.</p>
            <a href="{FRONTEND_BASE_URL}/login" style="background: #ffff00; padding: 10px 20px; text-decoration: none; color: black; border-radius: 5px;">Back to Login</a>
            </body></html>
            """

        # Update Firebase user as verified
        if FIREBASE_ENABLED:
            try:
                # Get user by email
                user = auth.get_user_by_email(email)

                # Update user as verified
                auth.update_user(
                    user.uid,
                    email_verified=True
                )

                print(f"✅ Email verified for user: {email}")

                # Success page
                return f"""
                <html><body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: green;">✅ Email Verified Successfully!</h1>
                <p>Great! Your email address has been verified. You can now log in to your Solthron account.</p>
                <div style="margin: 30px 0;">
                    <h3>🎯 What's Next?</h3>
                    <ol style="text-align: left; display: inline-block;">
                        <li>Log in to your account</li>
                        <li>Install the Chrome extension</li>
                        <li>Start optimizing your AI prompts</li>
                    </ol>
                </div>
                <a href="{FRONTEND_BASE_URL}/login" style="background: #ffff00; padding: 15px 30px; text-decoration: none; color: black; border-radius: 5px; font-weight: bold; margin: 10px;">Login Now</a>
                <p style="margin-top: 30px; color: #666; font-size: 14px;">Redirecting to login in 5 seconds...</p>
                <script>setTimeout(function(){{ window.location.href = '{FRONTEND_BASE_URL}/login'; }}, 5000);</script>
                </body></html>
                """

            except auth.UserNotFoundError:
                print(f"❌ User not found: {email}")
                return f"""
                <html><body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: red;">❌ User Not Found</h1>
                <p>No account found with this email address.</p>
                <a href="{FRONTEND_BASE_URL}/signup" style="background: #ffff00; padding: 10px 20px; text-decoration: none; color: black; border-radius: 5px;">Create Account</a>
                </body></html>
                """
            except Exception as firebase_error:
                print(f"❌ Firebase error: {firebase_error}")
                return f"""
                <html><body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1 style="color: red;">❌ Verification Error</h1>
                <p>There was an issue verifying your account. Please try again or contact support.</p>
                <a href="{FRONTEND_BASE_URL}/login" style="background: #ffff00; padding: 10px 20px; text-decoration: none; color: black; border-radius: 5px;">Back to Login</a>
                </body></html>
                """
        else:
            return f"""
            <html><body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Service Unavailable</h1>
            <p>Email verification service is temporarily unavailable.</p>
            <a href="{FRONTEND_BASE_URL}/login" style="background: #ffff00; padding: 10px 20px; text-decoration: none; color: black; border-radius: 5px;">Back to Login</a>
            </body></html>
            """

    except Exception as e:
        print(f"❌ Verification error: {e}")
        return f"""
        <html><body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1 style="color: red;">❌ Server Error</h1>
        <p>An unexpected error occurred during verification.</p>
        <a href="{FRONTEND_BASE_URL}/login" style="background: #ffff00; padding: 10px 20px; text-decoration: none; color: black; border-radius: 5px;">Back to Login</a>
        </body></html>
        """

@app.route('/resend-verification', methods=['POST'])
def resend_verification():
    """Resend verification email"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        first_name = data.get('firstName', '').strip()

        if not email:
            return jsonify({'error': 'Email is required'}), 400

        print(f"🔄 Resending verification email to: {email}")

        # Send verification email
        result = send_verification_email_mailgun(email, first_name)

        if result["success"]:
            return jsonify({
                'success': True,
                'message': 'Verification email resent successfully'
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Failed to resend verification email',
                'use_firebase_fallback': True
            }), 500

    except Exception as e:
        print(f"❌ Resend verification error: {e}")
        return jsonify({
            'error': 'Failed to resend verification email',
            'details': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)

# Set application variable for PythonAnywhere
application = app
