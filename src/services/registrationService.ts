import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { TeamInfo } from '../db/repositories.js';
import { log } from '../utils/logger.js';

puppeteer.use(StealthPlugin());

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RegistrationParams {
    gameUrl: string;
    teamInfo: TeamInfo;
    playerCount: number;
}

export interface RegistrationResult {
    success: boolean;
    error?: string;
}

export async function registerForGame(params: RegistrationParams): Promise<RegistrationResult> {
    const { gameUrl, teamInfo, playerCount } = params;
    
    log.info(`[Registration] Starting registration for: ${gameUrl}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
            ],
        });
        
        const page = await browser.newPage();
        
        // Set realistic user agent and headers
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        );
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
        });
        
        // Override webdriver flag
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            
            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });
            
            // Mock languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['ru-RU', 'ru', 'en-US', 'en'],
            });
        });
        
        await page.setViewport({ width: 1280, height: 1400 });

        const targetOrigin = (() => {
            const parseUrl = (value: string): string | null => {
                try {
                    const parsed = new URL(value);
                    return parsed.origin;
                } catch {
                    return null;
                }
            };
            
            // Try parsing the URL as-is
            const parsed = parseUrl(gameUrl);
            if (parsed) {
                return parsed;
            }
            
            // Try with https:// prefix if missing
            const normalized = gameUrl.startsWith('http') ? gameUrl : `https://${gameUrl}`;
            const parsedNormalized = parseUrl(normalized);
            if (parsedNormalized) {
                return parsedNormalized;
            }
            
            // Fallback: extract domain from string
            const match = gameUrl.match(/([a-z0-9-]+\.quizplease\.ru)/i);
            if (match?.[1]) {
                return `https://${match[1].toLowerCase()}`;
            }
            
            log.warn('[Registration] Failed to parse gameUrl origin, falling back to default quizplease domain', {
                gameUrl,
            });
            return 'https://quizplease.ru';
        })();

        async function warmupNavigation(origin: string) {
            const warmupUrls = Array.from(
                new Set([
                    `${origin}/`,
                    new URL('/schedule', origin).toString(),
                ])
            );
            for (const warmUrl of warmupUrls) {
                try {
                    await page.goto(warmUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await sleep(1200);
                } catch (err) {
                    log.warn('[Registration] Warmup navigation failed:', err);
                }
            }
        }

        let formPresent: boolean | null = null;
        let pageSnippet = '';
        const maxAttempts = 3;

        // Helper to check if selector exists without using exceptions for control flow
        const checkSelectorExists = async (selector: string, timeout: number) => {
            try {
                return await page.waitForSelector(selector, { timeout });
            } catch {
                return null;
            }
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            log.info(`[Registration] Navigating to: ${gameUrl} (attempt ${attempt})`);
            await page.goto(gameUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            await sleep(1500);

            const formHandle = await checkSelectorExists('form#main-form', 10000);
            if (formHandle) {
                formPresent = true;
                break;
            }

            pageSnippet = await page.evaluate(() => document.body.innerText.slice(0, 600));
            const antiBotDetected = /запросы.*(не\s*робот|роботом)/i.test(pageSnippet);

            if (antiBotDetected && attempt < maxAttempts) {
                log.warn('[Registration] Anti-bot page detected, performing warm-up navigation before retry');
                await warmupNavigation(targetOrigin);
                continue;
            }

            break;
        }

        if (!formPresent) {
            if (!pageSnippet) {
                pageSnippet = await page.evaluate(() => document.body.innerText.slice(0, 600));
            }
            log.error('[Registration] Registration form not found on page');
            return { success: false, error: `Registration form not found on page. Snippet: ${pageSnippet}` };
        }
        
        // Check for CAPTCHA
        const bodyText = await page.evaluate(() => document.body.textContent || '');
        if (bodyText.toLowerCase().includes('captcha') || bodyText.toLowerCase().includes('подтвердите')) {
            log.error('[Registration] CAPTCHA detected');
            return { success: false, error: 'CAPTCHA detected on registration page' };
        }
        
        // Fill out the form
        log.info('[Registration] Filling out registration form');
        
        // Helper to set text inputs reliably
        const setTextInput = async (selector: string, value: string): Promise<boolean> => {
            const exists = await checkSelectorExists(selector, 15000);
            if (!exists) {
                return false;
            }
            await page.evaluate(
                (sel, v) => {
                    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
                    if (!el) return;
                    el.focus();
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                },
                selector,
                value
            );
            return true;
        };
        
        const teamNameSet = await setTextInput('input[name="QpRecord[teamName]"]', teamInfo.team_name);
        if (!teamNameSet) {
            return { success: false, error: 'Input not found: input[name="QpRecord[teamName]"]' };
        }
        const captainNameSet = await setTextInput('input[name="QpRecord[captainName]"]', teamInfo.captain_name);
        if (!captainNameSet) {
            return { success: false, error: 'Input not found: input[name="QpRecord[captainName]"]' };
        }
        const emailSet = await setTextInput('input[name="QpRecord[email]"]', teamInfo.email);
        if (!emailSet) {
            return { success: false, error: 'Input not found: input[name="QpRecord[email]"]' };
        }
        const phoneSet = await setTextInput('input[name="QpRecord[phone]"]', teamInfo.phone);
        if (!phoneSet) {
            return { success: false, error: 'Input not found: input[name="QpRecord[phone]"]' };
        }
        
        // Number of players - select from dropdown (hidden select, so set via script)
        const playersSelector = 'select[name="QpRecord[count]"]';
        const playersSelectExists = await checkSelectorExists(playersSelector, 8000);
        if (!playersSelectExists) {
            throw new Error(`Players select not found: ${playersSelector}`);
        }
        await page.evaluate(
            (selector, value) => {
                const el = document.querySelector<HTMLSelectElement>(selector);
                if (!el) return;
                el.value = value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            },
            playersSelector,
            String(playerCount)
        );
        
        log.info(`[Registration] Form filled with ${playerCount} players`);
        
        // Check privacy policy checkbox (required)
        const ensureCheckbox = async (selector: string, description: string) => {
            const exists = await page.$(selector);
            if (!exists) {
                log.warn(`[Registration] ${description} checkbox not found (selector: ${selector})`);
                return;
            }
            await page.evaluate((sel) => {
                const el = document.querySelector<HTMLInputElement>(sel);
                if (!el) return;
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, selector);
        };
        
        await ensureCheckbox('input.agreement-checkbox__js', 'Privacy agreement');
        await ensureCheckbox('input.mailing-checkbox__js', 'Mailing consent');
        log.info('[Registration] Consent checkboxes set');
        
        // Small delay before submission
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Click the register button
        const registerButtonSelector = 'button[type="submit"]';
        const registerButton = await page.$(registerButtonSelector);
        if (registerButton) {
            await page.evaluate((selector) => {
                const el = document.querySelector<HTMLButtonElement>(selector);
                const form = el?.closest('form');
                if (form && form instanceof HTMLFormElement && form.requestSubmit) {
                    form.requestSubmit(el);
                } else {
                    el?.click();
                }
            }, registerButtonSelector);
        } else {
            log.warn('[Registration] Submit button not found, attempting form submit');
            await page.evaluate(() => {
                const form = document.querySelector<HTMLFormElement>('form#main-form');
                form?.submit();
            });
        }
        
        log.info('[Registration] Registration button clicked, waiting for response...');
        
        // Wait for navigation or success message
        // Note: waitForNavigation is deprecated, using setTimeout as alternative
        await new Promise(resolve => setTimeout(resolve, 4000)); // Wait 4 seconds for any navigation or AJAX response
        
        // Check for success indicators
        const finalBodyText = await page.evaluate(() => document.body.textContent || '');
        
        // Look for success messages (adjust these based on actual site responses)
        const successIndicators = [
            'успешно',
            'зарегистрирован',
            'спасибо',
            'подтверждение',
            'отправлено',
        ];
        
        const hasSuccessIndicator = successIndicators.some(indicator => 
            finalBodyText.toLowerCase().includes(indicator)
        );
        
        // Also check for error messages
        const errorIndicators = [
            'ошибка',
            'неверно',
            'заполните',
            'обязательно',
        ];
        
        const hasErrorIndicator = errorIndicators.some(indicator => 
            finalBodyText.toLowerCase().includes(indicator)
        );
        
        if (hasErrorIndicator) {
            log.error('[Registration] Error detected in response');
            return { success: false, error: 'Error message detected on page after submission' };
        }
        
        if (hasSuccessIndicator) {
            log.info('[Registration] Success! Registration completed');
            return { success: true };
        }
        
        // If no clear indicator, assume success (could be improved with screenshot analysis)
        log.warn('[Registration] No clear success/error indicator, assuming success');
        return { success: true };
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error('[Registration] Error during registration:', errorMsg);
        return { success: false, error: errorMsg };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}
