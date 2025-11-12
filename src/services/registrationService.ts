import puppeteer from 'puppeteer';
import type { TeamInfo } from '../db/repositories.js';
import { log } from '../utils/logger.js';

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
        
        log.info(`[Registration] Navigating to: ${gameUrl}`);
        await page.goto(gameUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait a bit to simulate human behavior
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Check for CAPTCHA
        const bodyText = await page.evaluate(() => document.body.textContent || '');
        if (bodyText.toLowerCase().includes('captcha') || bodyText.toLowerCase().includes('подтвердите')) {
            log.error('[Registration] CAPTCHA detected');
            return { success: false, error: 'CAPTCHA detected on registration page' };
        }
        
        // Fill out the form
        log.info('[Registration] Filling out registration form');
        
        // Team name
        const teamNameSelector = 'input[name="team"]';
        await page.waitForSelector(teamNameSelector, { timeout: 10000 });
        await page.type(teamNameSelector, teamInfo.team_name, { delay: 100 });
        
        // Captain name
        const captainSelector = 'input[name="name"]';
        await page.type(captainSelector, teamInfo.captain_name, { delay: 100 });
        
        // Email
        const emailSelector = 'input[name="email"]';
        await page.type(emailSelector, teamInfo.email, { delay: 100 });
        
        // Phone
        const phoneSelector = 'input[name="phone"]';
        await page.type(phoneSelector, teamInfo.phone, { delay: 100 });
        
        // Number of players - select from dropdown
        const playersSelector = 'select[name="num"]';
        await page.select(playersSelector, String(playerCount));
        
        log.info(`[Registration] Form filled with ${playerCount} players`);
        
        // Check privacy policy checkbox
        const privacyCheckboxSelector = 'input[name="privacy"]';
        await page.click(privacyCheckboxSelector);
        
        log.info('[Registration] Privacy policy checkbox checked');
        
        // Small delay before submission
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Click the register button
        const registerButtonSelector = 'button[type="submit"]';
        await page.click(registerButtonSelector);
        
        log.info('[Registration] Registration button clicked, waiting for response...');
        
        // Wait for navigation or success message
        try {
            await page.waitForNavigation({ timeout: 10000, waitUntil: 'networkidle2' });
        } catch (e) {
            // Navigation might not happen if it's an AJAX form
            log.info('[Registration] No navigation, checking for success indicators...');
        }
        
        // Check for success indicators
        await new Promise(resolve => setTimeout(resolve, 2000));
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
