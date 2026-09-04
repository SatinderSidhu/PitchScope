// The guide page bundles the same Indic faces as the app, so the sargam
// examples render on any machine rather than relying on system fonts.
import '@fontsource/noto-sans-gurmukhi/400.css'
import '@fontsource/noto-sans-devanagari/400.css'
import '@fontsource/noto-sans-arabic/400.css'
import './help.css'

// Highlight the section currently in view in the contents list.
const links = [...document.querySelectorAll('nav a')]
const sections = links
  .map(a => document.querySelector(a.getAttribute('href')))
  .filter(Boolean)

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const id = '#' + entry.target.id
    links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === id))
  }
}, { rootMargin: '-8% 0px -55% 0px' })

sections.forEach(s => observer.observe(s))

// Nothing intersects the band at the very top of the page, so start the first
// entry marked rather than leaving the list looking inert.
links[0]?.classList.add('active')
