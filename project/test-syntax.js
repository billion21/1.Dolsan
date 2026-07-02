// Simple syntax test for server.js
console.log('Testing server.js syntax...');

try {
    // Try to require the server file to check for syntax errors
    require('./server.js');
    console.log('✅ server.js syntax is valid');
} catch (error) {
    console.error('❌ Syntax error in server.js:', error.message);
    console.error('Stack trace:', error.stack);
}
