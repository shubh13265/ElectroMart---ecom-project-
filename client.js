document.addEventListener('DOMContentLoaded', () => {

    // Get the forms
    const registerForm = document.getElementById('register-form');
    const loginForm = document.getElementById('login-form');
    
    // --- NEW: Get Modal Elements ---
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalIcon = document.getElementById('modal-icon');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    // --- NEW: Function to show the modal ---
    function showModal(title, message, isSuccess) {
        modalTitle.textContent = title;
        modalMessage.textContent = message;

        if (isSuccess) {
            modalIcon.innerHTML = '&#10004;'; // Checkmark
            modalIcon.className = 'modal-icon success';
        } else {
            modalIcon.innerHTML = '&#10006;'; // X mark
            modalIcon.className = 'modal-icon error';
        }
        
        modalOverlay.classList.add('show');
    }

    // --- NEW: Event listener to close the modal ---
    modalCloseBtn.addEventListener('click', () => {
        modalOverlay.classList.remove('show');
    });

    // --- Register Form Event Listener (Updated) ---
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;

        try {
            const response = await fetch('http://localhost:3001/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password }),
            });
            const data = await response.json();

            // --- Use Modal instead of message-box ---
            if (response.ok) {
                showModal('Success!', data.message, true);
                registerForm.reset(); // Clear the form
            } else {
                showModal('Error', data.message, false);
            }
        } catch (error) {
            showModal('Network Error', 'Failed to connect to server', false);
        }
    });

    // --- Login Form Event Listener (Updated) ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch('http://localhost:3001/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await response.json();

            // --- Use Modal instead of message-box ---
            if (response.ok) {
                // Show success modal, then redirect
                showModal('Success!', data.message, true);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                // Close the modal and redirect after 1.5 seconds
                setTimeout(() => {
                    modalOverlay.classList.remove('show');
                    window.location.href = 'shop.html';
                }, 1500);

            } else {
                showModal('Error', data.message, false);
            }
        } catch (error) {
            showModal('Network Error', 'Failed to connect to server', false);
        }
    });
});